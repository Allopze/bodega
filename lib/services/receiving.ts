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
import { receiveItem } from "./item-state"
import { applyMovement } from "./warehouse"

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

  // Create receipt header
  await db.insert(receipts).values({
    id:              receiptId,
    code,
    purchaseOrderId: input.purchaseOrderId,
    receivedBy:      input.receivedBy,
    receivedAt:      now,
    locationType:    input.locationType,
    worksiteId:      input.worksiteId ?? null,
    dispatchGuideNo: input.dispatchGuideNo ?? null,
    status:          "open",
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

    await db.insert(receiptItems).values({
      id:                  nanoid(),
      receiptId,
      purchaseOrderItemId: ri.purchaseOrderItemId,
      quantityReceived:    qtyRec,
      quantityRejected:    qtyRej,
      quantityDamaged:     qtyDmg,
      status:              qtyRec >= ocItem.quantity ? "received" : "partially_received",
      notes:               ri.notes ?? null,
    })

    // Update OC item quantityReceived
    const totalNowReceived = (ocItem.quantityReceived ?? 0) + qtyRec
    await db
      .update(purchaseOrderItems)
      .set({ quantityReceived: totalNowReceived })
      .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))

    // Transition the linked purchase request item
    if (ocItem.requestItemId) {
      const fullReceived = totalNowReceived >= ocItem.quantity
      await receiveItem(ocItem.requestItemId, input.receivedBy, {
        fullReceived,
        userEmail: input.userEmail,
      })

      // If going to warehouse and product is catalogued, apply warehouse ingress
      if (input.locationType === "warehouse" && input.warehouseId && ocItem.productId) {
        await applyMovement({
          warehouseId:   input.warehouseId,
          productId:     ocItem.productId,
          type:          "ingreso_oc",
          quantity:      qtyRec,              // positive = in
          referenceType: "purchase_order",
          referenceId:   input.purchaseOrderId,
          performedBy:   input.receivedBy,
          userEmail:     input.userEmail,
          notes:         `Recepción ${code} — guía ${input.dispatchGuideNo ?? "s/n"}`,
        })
      }
    }
  }

  // Roll up OC status
  await rollupOrderReceiptStatus(input.purchaseOrderId)

  // Audit
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
  })

  return receiptId
}

/* ── Roll up OC status based on received quantities ────────────────────────────  */

async function rollupOrderReceiptStatus(orderId: string): Promise<void> {
  const ocItems = await db
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
  await db
    .update(purchaseOrders)
    .set({ status: newStatus, updatedAt: now })
    .where(eq(purchaseOrders.id, orderId))
}
