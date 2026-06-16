/**
 * Receiving service — register receipt of goods from a purchase order.
 * Handles receipt + receipt items + OC quantity updates + item status transitions
 * + worksite stock ingress.
 */

import { eq, and, notInArray } from "drizzle-orm"
import { db } from "@/db"
import {
  receipts, receiptItems,
  purchaseOrders, purchaseOrderItems,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { receiveItemTx } from "./item-state"
import { applyMovementTx } from "./stock"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface ReceiptItemInput {
  purchaseOrderItemId: string
  quantityReceived:    number
  quantityRejected?:   number
  quantityDamaged?:    number
  notes?:              string | null
}

export interface RegisterReceiptInput {
  purchaseOrderId:  string
  receivedBy:       string
  userEmail?:       string
  stage:            "office" | "faena"
  worksiteId?:      string | null
  dispatchGuideNo?: string | null
  notes?:           string | null
  items:            ReceiptItemInput[]
}

/* ── Register receipt ────────────────────────────────────────────────────────── */

export async function registerReceipt(input: RegisterReceiptInput): Promise<string> {
  if (input.items.length === 0) {
    throw new Error("At least one received item is required")
  }
  const itemIds = input.items.map((item) => item.purchaseOrderItemId)
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("Receipt contains duplicated order items")
  }

  const receiptId = nanoid()
  const now       = new Date().toISOString()
  const year      = new Date().getFullYear()

  const code = await db.transaction(async (tx) => {
    // Read order INSIDE the transaction to avoid stale status checks.
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, input.purchaseOrderId),
    })
    if (!order) throw new Error(`Purchase order ${input.purchaseOrderId} not found`)
    if (!["sent", "partially_office_received", "office_received", "partially_received"].includes(order.status)) {
      throw new Error(`Cannot receive against order in state '${order.status}'`)
    }
    if (input.stage === "faena" && order.status === "sent") {
      throw new Error("Debes registrar primero la llegada a oficina antes de recibir en faena")
    }

    const worksiteId = input.worksiteId ?? order.worksiteId
    const txCode = await nextCodeTx(tx, "REC", year)

    await tx.insert(receipts).values({
      id:              receiptId,
      code:            txCode,
      purchaseOrderId: input.purchaseOrderId,
      receivedBy:      input.receivedBy,
      receivedAt:      now,
      locationType:    input.stage,
      worksiteId,
      dispatchGuideNo: input.dispatchGuideNo ?? null,
      status:          "closed",
      notes:           input.notes ?? null,
      createdAt:       now,
    })

    for (const ri of input.items) {
      const qtyRec = ri.quantityReceived
      const qtyRej = ri.quantityRejected ?? 0
      const qtyDmg = ri.quantityDamaged  ?? 0

      // Lock the OC item row to serialize concurrent receipts on the same item.
      const [lockedOcItem] = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))
        .for("update")

      if (!lockedOcItem || lockedOcItem.purchaseOrderId !== input.purchaseOrderId) {
        throw new Error(`OC item ${ri.purchaseOrderItemId} not in this order`)
      }

      // Office stage caps at the ordered quantity; faena stage caps STRICTLY at what already
      // arrived at office (no fallback to the full quantity → the direct-to-faena path is closed).
      const currentReceived = input.stage === "office"
        ? (lockedOcItem.quantityOfficeReceived ?? 0)
        : (lockedOcItem.quantityReceived ?? 0)
      const remaining = input.stage === "office"
        ? lockedOcItem.quantity - (lockedOcItem.quantityOfficeReceived ?? 0)
        : (lockedOcItem.quantityOfficeReceived ?? 0) - (lockedOcItem.quantityReceived ?? 0)

      if (!Number.isFinite(qtyRec) || qtyRec <= 0) {
        throw new Error("Received quantity must be greater than 0")
      }
      if (qtyRec > remaining) {
        throw new Error(`Received quantity exceeds pending quantity for item ${ri.purchaseOrderItemId}`)
      }
      if (qtyRej < 0 || qtyDmg < 0) {
        throw new Error("Rejected and damaged quantities cannot be negative")
      }

      const totalNowReceived = currentReceived + qtyRec
      await tx.insert(receiptItems).values({
        id:                  nanoid(),
        receiptId,
        purchaseOrderItemId: ri.purchaseOrderItemId,
        quantityReceived:    qtyRec,
        quantityRejected:    qtyRej,
        quantityDamaged:     qtyDmg,
        status:              totalNowReceived >= lockedOcItem.quantity ? "received" : "partially_received",
        notes:               ri.notes ?? null,
      })

      await tx
        .update(purchaseOrderItems)
        .set(input.stage === "office"
          ? { quantityOfficeReceived: totalNowReceived }
          : { quantityReceived: totalNowReceived })
        .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))

      if (input.stage === "faena" && lockedOcItem.requestItemId) {
        const fullReceived = totalNowReceived >= lockedOcItem.quantity
        await receiveItemTx(tx, lockedOcItem.requestItemId, input.receivedBy, {
          fullReceived,
          userEmail: input.userEmail,
        })

        if (worksiteId && lockedOcItem.productId) {
          await applyMovementTx(tx, {
            worksiteId,
            productId:   lockedOcItem.productId,
            type:        "ingreso_oc",
            quantity:    qtyRec,
            referenceType: "purchase_order",
            referenceId: input.purchaseOrderId,
            performedBy: input.receivedBy,
            userEmail:   input.userEmail,
            notes:       `Recepción ${txCode} — guía ${input.dispatchGuideNo ?? "s/n"}`,
          })
        }
      }
    }

    await rollupOrderReceiptStatus(input.purchaseOrderId, tx)

    await recordAudit({
      userId:     input.receivedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "receipt",
      entityId:   receiptId,
      entityCode: txCode,
      newState:   {
        purchaseOrderId: input.purchaseOrderId,
        stage:           input.stage,
        worksiteId,
        itemCount:       input.items.length,
      },
    }, tx)

    return txCode
  })

  void code // used only for audit above; receiptId is returned

  return receiptId
}

/* ── Roll up OC status based on received quantities ────────────────────────────  */

async function rollupOrderReceiptStatus(
  orderId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  const ocItems = await tx
    .select({
      quantity:               purchaseOrderItems.quantity,
      quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
      quantityReceived:       purchaseOrderItems.quantityReceived,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

  if (ocItems.length === 0) return

  // Deterministic rollup from item quantities. Office is always first, so the
  // invariant quantityReceived ≤ quantityOfficeReceived ≤ quantity holds, giving a
  // monotonic chain: sent → partially_office_received → office_received → partially_received → received.
  const allFaena  = ocItems.every((i) => (i.quantityReceived       ?? 0) >= i.quantity)
  const anyFaena  = ocItems.some( (i) => (i.quantityReceived       ?? 0) > 0)
  const allOffice = ocItems.every((i) => (i.quantityOfficeReceived ?? 0) >= i.quantity)
  const anyOffice = ocItems.some( (i) => (i.quantityOfficeReceived ?? 0) > 0)

  let newStatus: string
  if (allFaena)        newStatus = "received"
  else if (anyFaena)   newStatus = "partially_received"
  else if (allOffice)  newStatus = "office_received"
  else if (anyOffice)  newStatus = "partially_office_received"
  else return

  const now = new Date().toISOString()
  await tx
    .update(purchaseOrders)
    .set({ status: newStatus, updatedAt: now })
    // Never pull a manually closed/cancelled order back into the receiving flow.
    .where(and(
      eq(purchaseOrders.id, orderId),
      notInArray(purchaseOrders.status, ["closed", "cancelled"]),
    ))
}
