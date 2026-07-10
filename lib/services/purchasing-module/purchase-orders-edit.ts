/**
 * Correct the items of a purchase order that's already sent/supplier_confirmed
 * (e.g. the supplier rejected it for a quantity/price error) without going
 * through anular + re-create.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { computeOrderTotals } from "@/lib/order-totals"
import { isOrderItemsEditable } from "@/lib/services/purchasing.constants"

export interface EditableOrderItemInput {
  id?:             string
  productId:       string | null
  productNameFree: string | null
  quantity:        number
  unitOfMeasure:   string
  unitPrice:       number
  discount?:       number
  notes?:          string | null
}

export async function updateSentOrderItems(
  orderId: string,
  items: EditableOrderItemInput[],
  reason: string,
  userId: string,
  worksiteIds: string[] | "all" = "all",
  opts?: { userEmail?: string },
): Promise<void> {
  if (items.length === 0) throw new Error("La orden debe tener al menos un ítem")

  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== "all" && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const currentItems = await tx
      .select({
        id:                     purchaseOrderItems.id,
        requestItemId:          purchaseOrderItems.requestItemId,
        quantityReceived:       purchaseOrderItems.quantityReceived,
        quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
      })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const totalReceived = currentItems.reduce(
      (sum, i) => sum + i.quantityReceived + i.quantityOfficeReceived,
      0,
    )
    if (!isOrderItemsEditable(order.status, totalReceived)) {
      throw new Error(`No se pueden editar los ítems de una orden en estado '${order.status}'`)
    }

    const currentById = new Map(currentItems.map((i) => [i.id, i]))
    for (const item of items) {
      if (item.id && !currentById.has(item.id)) {
        throw new Error(`El ítem ${item.id} no pertenece a esta orden`)
      }
    }

    const incomingIds = new Set(items.flatMap((i) => (i.id ? [i.id] : [])))
    const removedItems = currentItems.filter((i) => !incomingIds.has(i.id))
    const removedRequestItemIds = removedItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    const now = new Date().toISOString()

    if (removedRequestItemIds.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, removedRequestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
          ),
        )
    }
    for (const removed of removedItems) {
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, removed.id))
    }

    for (const [i, item] of items.entries()) {
      const discount = item.discount ?? 0
      const subtotal = Math.round(item.quantity * item.unitPrice * (1 - discount / 100))

      if (item.id) {
        await tx
          .update(purchaseOrderItems)
          .set({
            productId:       item.productId,
            productNameFree: item.productNameFree,
            quantity:        item.quantity,
            unitOfMeasure:   item.unitOfMeasure,
            unitPrice:       item.unitPrice,
            discount,
            subtotal,
            notes:           item.notes ?? null,
            sortOrder:       i,
          })
          .where(eq(purchaseOrderItems.id, item.id))
      } else {
        await tx.insert(purchaseOrderItems).values({
          id:               nanoid(),
          purchaseOrderId:  orderId,
          requestItemId:    null,
          productId:        item.productId,
          productNameFree:  item.productNameFree,
          quantity:         item.quantity,
          unitOfMeasure:    item.unitOfMeasure,
          unitPrice:        item.unitPrice,
          discount,
          subtotal,
          quantityReceived: 0,
          status:           "issued",
          sortOrder:        i,
          notes:            item.notes ?? null,
        })
      }
    }

    const totals = computeOrderTotals(items)
    await tx
      .update(purchaseOrders)
      .set({
        netAmount:   totals.netAmount,
        taxAmount:   totals.taxAmount,
        totalAmount: totals.totalAmount,
        updatedAt:   now,
      })
      .where(eq(purchaseOrders.id, orderId))

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "update",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { totalAmount: order.totalAmount, itemCount: currentItems.length },
      newState:   { totalAmount: totals.totalAmount, itemCount: items.length },
      reason,
    }, tx)
  })
}
