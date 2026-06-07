/**
 * Purchasing service — OC lifecycle: create, issue, send.
 * All DB mutations here, never in Server Actions or UI components.
 */

import { eq, count, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems } from "@/db/schema"
import { nanoid, generateCode } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { computeOrderTotals } from "@/lib/order-totals"
import { addItemToPurchaseOrderTx } from "./item-state"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface CreateOrderItemInput {
  requestItemId: string
  productId:     string | null
  productNameFree: string | null
  quantity:      number
  unitOfMeasure: string
  unitPrice:     number
  discount?:     number
  notes?:        string | null
  sortOrder?:    number
}

export interface CreateOrderInput {
  worksiteId:         string
  supplierId:         string
  createdBy:          string
  userEmail?:         string
  paymentTerms?:      string | null
  estimatedDelivery?: string | null
  deliveryAddress?:   string | null
  notes?:             string | null
  items:              CreateOrderItemInput[]
}

/* ── Create OC ───────────────────────────────────────────────────────────────── */

export async function createOrder(input: CreateOrderInput): Promise<string> {
  const orderId   = nanoid()
  const now       = new Date().toISOString()
  const year      = new Date().getFullYear()

  const [{ total }] = await db.select({ total: count() }).from(purchaseOrders)
  const code        = generateCode("OC", total + 1, year)
  const totals      = computeOrderTotals(input.items)

  await db.transaction(async (tx) => {
    // Create the order header
    await tx.insert(purchaseOrders).values({
      id:                orderId,
      code,
      worksiteId:        input.worksiteId,
      supplierId:        input.supplierId,
      createdBy:         input.createdBy,
      status:            "draft",
      paymentTerms:      input.paymentTerms ?? null,
      estimatedDelivery: input.estimatedDelivery ?? null,
      deliveryAddress:   input.deliveryAddress ?? null,
      notes:             input.notes ?? null,
      netAmount:         totals.netAmount,
      taxAmount:         totals.taxAmount,
      totalAmount:       totals.totalAmount,
      createdAt:         now,
      updatedAt:         now,
    })

    // Insert OC items
    for (let i = 0; i < input.items.length; i++) {
      const item     = input.items[i]
      const subtotal = Math.round(
        item.quantity * item.unitPrice * (1 - (item.discount ?? 0) / 100)
      )
      await tx.insert(purchaseOrderItems).values({
        id:              nanoid(),
        purchaseOrderId: orderId,
        requestItemId:   item.requestItemId,
        productId:       item.productId,
        productNameFree: item.productNameFree,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        unitPrice:       item.unitPrice,
        discount:        item.discount ?? 0,
        subtotal,
        quantityReceived: 0,
        status:          "issued",
        sortOrder:       item.sortOrder ?? i,
        notes:           item.notes ?? null,
      })
    }

    await recordAudit({
      userId:     input.createdBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: code,
      newState:   { status: "draft", totalAmount: totals.totalAmount, itemCount: input.items.length },
    }, tx)

    for (const item of input.items) {
      await addItemToPurchaseOrderTx(tx, item.requestItemId, orderId, input.createdBy, {
        userEmail: input.userEmail,
      })
    }
  })

  return orderId
}

/* ── Issue OC (draft → issued) ───────────────────────────────────────────────── */

export async function issueOrder(
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (order.status !== "draft") {
      throw new Error(`Cannot issue order in state '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "issued", issuedAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "draft",
      toStatus:   "issued",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "draft" },
      newState:   { status: "issued" },
    }, tx)
  })
}

/* ── Mark as sent (issued → sent) ────────────────────────────────────────────── */

export async function markOrderSent(
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (order.status !== "issued") {
      throw new Error(`Cannot mark order as sent from state '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move request items to "purchased" status
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      const itemNow = new Date().toISOString()
      await tx
        .update(purchaseRequestItems)
        .set({ status: "purchased", updatedAt: itemNow })
        .where(
          inArray(purchaseRequestItems.id, requestItemIds),
        )

      for (const reqItemId of requestItemIds) {
        await recordStatusChange({
          entityType: "request_item",
          entityId:   reqItemId,
          fromStatus: "in_purchase_order",
          toStatus:   "purchased",
          changedBy:  userId,
        }, tx)
      }
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "issued",
      toStatus:   "sent",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "issued" },
      newState:   { status: "sent" },
    }, tx)
  })
}
