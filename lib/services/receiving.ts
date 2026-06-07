/**
 * Receiving service — register receipt of goods from a purchase order.
 * Handles receipt + receipt items + OC quantity updates + item status transitions
 * + warehouse stock ingress (if destination is a warehouse).
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  receipts, receiptItems,
  purchaseOrders, purchaseOrderItems,
} from "@/db/schema"
import { nanoid, generateCode } from "@/lib/id"
import { count } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { receiveItemTx } from "./item-state"
import { applyMovementTx } from "./warehouse"

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
  /** "faena" = goes directly to the worksite, "warehouse" = goes to a warehouse */
  locationType:     "faena" | "warehouse"
  worksiteId?:      string | null
  warehouseId?:     string | null
  dispatchGuideNo?: string | null
  notes?:           string | null
  items:            ReceiptItemInput[]
}

/* ── Register receipt ────────────────────────────────────────────────────────── */

export async function registerReceipt(input: RegisterReceiptInput): Promise<string> {
  if (input.locationType === "warehouse" && !input.warehouseId) {
    throw new Error("warehouseId is required when locationType is 'warehouse'")
  }
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

  const [{ total }] = await db.select({ total: count() }).from(receipts)
  const code        = generateCode("REC", total + 1, year)

  // Load the OC to validate it's in a receivable state
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, input.purchaseOrderId),
    with:  { items: true },
  })
  if (!order) throw new Error(`Purchase order ${input.purchaseOrderId} not found`)
  if (!["sent", "partially_received"].includes(order.status)) {
    throw new Error(`Cannot receive against order in state '${order.status}'`)
  }

  await db.transaction(async (tx) => {
    // Create receipt header
    await tx.insert(receipts).values({
      id:              receiptId,
      code,
      purchaseOrderId: input.purchaseOrderId,
      receivedBy:      input.receivedBy,
      receivedAt:      now,
      locationType:    input.locationType,
      worksiteId:      input.worksiteId ?? order.worksiteId,
      dispatchGuideNo: input.dispatchGuideNo ?? null,
      status:          "closed",
      notes:           input.notes ?? null,
      createdAt:       now,
    })

    // Process each receipt item
    for (const ri of input.items) {
      // Load the OC item
      const ocItem = order.items.find((i) => i.id === ri.purchaseOrderItemId)
      if (!ocItem) throw new Error(`OC item ${ri.purchaseOrderItemId} not in this order`)

      const qtyRec = ri.quantityReceived
      const qtyRej = ri.quantityRejected ?? 0
      const qtyDmg = ri.quantityDamaged  ?? 0
      const remaining = ocItem.quantity - (ocItem.quantityReceived ?? 0)

      if (!Number.isFinite(qtyRec) || qtyRec <= 0) {
        throw new Error("Received quantity must be greater than 0")
      }
      if (qtyRec > remaining) {
        throw new Error(`Received quantity exceeds pending quantity for item ${ri.purchaseOrderItemId}`)
      }
      if (qtyRej < 0 || qtyDmg < 0) {
        throw new Error("Rejected and damaged quantities cannot be negative")
      }

      const totalNowReceived = (ocItem.quantityReceived ?? 0) + qtyRec
      await tx.insert(receiptItems).values({
        id:                  nanoid(),
        receiptId,
        purchaseOrderItemId: ri.purchaseOrderItemId,
        quantityReceived:    qtyRec,
        quantityRejected:    qtyRej,
        quantityDamaged:     qtyDmg,
        status:              totalNowReceived >= ocItem.quantity ? "received" : "partially_received",
        notes:               ri.notes ?? null,
      })

      await tx
        .update(purchaseOrderItems)
        .set({ quantityReceived: totalNowReceived })
        .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))

      if (ocItem.requestItemId) {
        const fullReceived = totalNowReceived >= ocItem.quantity
        await receiveItemTx(tx, ocItem.requestItemId, input.receivedBy, {
          fullReceived,
          userEmail: input.userEmail,
        })

        if (input.locationType === "warehouse" && input.warehouseId && ocItem.productId) {
          await applyMovementTx(tx, {
            warehouseId:   input.warehouseId,
            productId:     ocItem.productId,
            type:          "ingreso_oc",
            quantity:      qtyRec,
            referenceType: "purchase_order",
            referenceId:   input.purchaseOrderId,
            performedBy:   input.receivedBy,
            userEmail:     input.userEmail,
            notes:         `Recepción ${code} — guía ${input.dispatchGuideNo ?? "s/n"}`,
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
      entityCode: code,
      newState:   {
        purchaseOrderId: input.purchaseOrderId,
        locationType:    input.locationType,
        warehouseId:     input.warehouseId,
        itemCount:       input.items.length,
      },
    }, tx)
  })

  return receiptId
}

/* ── Roll up OC status based on received quantities ────────────────────────────  */

async function rollupOrderReceiptStatus(orderId: string, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<void> {
  const ocItems = await tx
    .select({
      quantity:         purchaseOrderItems.quantity,
      quantityReceived: purchaseOrderItems.quantityReceived,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

  if (ocItems.length === 0) return

  const allFullyReceived = ocItems.every((i) => (i.quantityReceived ?? 0) >= i.quantity)
  const anyReceived      = ocItems.some((i) => (i.quantityReceived ?? 0) > 0)

  let newStatus: string
  if (allFullyReceived) {
    newStatus = "received"
  } else if (anyReceived) {
    newStatus = "partially_received"
  } else {
    return  // no change
  }

  const now = new Date().toISOString()
  await tx
    .update(purchaseOrders)
    .set({ status: newStatus, updatedAt: now })
    .where(eq(purchaseOrders.id, orderId))
}
