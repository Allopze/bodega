/**
 * Receiving service — register receipt of goods from a purchase order.
 * Handles receipt + receipt items + OC quantity updates + item status transitions
 * + worksite stock ingress.
 */

import { eq } from "drizzle-orm"
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
  let code!: string

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, input.purchaseOrderId),
    with:  { items: true },
  })
  if (!order) throw new Error(`Purchase order ${input.purchaseOrderId} not found`)
  if (!["sent", "partially_received"].includes(order.status)) {
    throw new Error(`Cannot receive against order in state '${order.status}'`)
  }

  const worksiteId = input.worksiteId ?? order.worksiteId

  db.transaction((tx) => {
    code = nextCodeTx(tx, "REC", year)

    tx.insert(receipts).values({
      id:              receiptId,
      code,
      purchaseOrderId: input.purchaseOrderId,
      receivedBy:      input.receivedBy,
      receivedAt:      now,
      locationType:    "faena",
      worksiteId,
      dispatchGuideNo: input.dispatchGuideNo ?? null,
      status:          "closed",
      notes:           input.notes ?? null,
      createdAt:       now,
    }).run()

    for (const ri of input.items) {
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
      tx.insert(receiptItems).values({
        id:                  nanoid(),
        receiptId,
        purchaseOrderItemId: ri.purchaseOrderItemId,
        quantityReceived:    qtyRec,
        quantityRejected:    qtyRej,
        quantityDamaged:     qtyDmg,
        status:              totalNowReceived >= ocItem.quantity ? "received" : "partially_received",
        notes:               ri.notes ?? null,
      }).run()

      tx
        .update(purchaseOrderItems)
        .set({ quantityReceived: totalNowReceived })
        .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId)).run()

      if (ocItem.requestItemId) {
        const fullReceived = totalNowReceived >= ocItem.quantity
        receiveItemTx(tx, ocItem.requestItemId, input.receivedBy, {
          fullReceived,
          userEmail: input.userEmail,
        })

        if (worksiteId && ocItem.productId) {
          applyMovementTx(tx, {
            worksiteId,
            productId:   ocItem.productId,
            type:        "ingreso_oc",
            quantity:    qtyRec,
            referenceType: "purchase_order",
            referenceId: input.purchaseOrderId,
            performedBy: input.receivedBy,
            userEmail:   input.userEmail,
            notes:       `Recepción ${code} — guía ${input.dispatchGuideNo ?? "s/n"}`,
          })
        }
      }
    }

    rollupOrderReceiptStatus(input.purchaseOrderId, tx)

    recordAudit({
      userId:     input.receivedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "receipt",
      entityId:   receiptId,
      entityCode: code,
      newState:   {
        purchaseOrderId: input.purchaseOrderId,
        worksiteId,
        itemCount:       input.items.length,
      },
    }, tx)
  })

  return receiptId
}

/* ── Roll up OC status based on received quantities ────────────────────────────  */

function rollupOrderReceiptStatus(orderId: string, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): void {
  const ocItems = tx
    .select({
      quantity:         purchaseOrderItems.quantity,
      quantityReceived: purchaseOrderItems.quantityReceived,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
    .all()

  if (ocItems.length === 0) return

  const allFullyReceived = ocItems.every((i) => (i.quantityReceived ?? 0) >= i.quantity)
  const anyReceived      = ocItems.some((i) => (i.quantityReceived ?? 0) > 0)

  let newStatus: string
  if (allFullyReceived) {
    newStatus = "received"
  } else if (anyReceived) {
    newStatus = "partially_received"
  } else {
    return
  }

  const now = new Date().toISOString()
  tx
    .update(purchaseOrders)
    .set({ status: newStatus, updatedAt: now })
    .where(eq(purchaseOrders.id, orderId)).run()
}
