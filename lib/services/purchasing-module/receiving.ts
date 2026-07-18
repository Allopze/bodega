/**
 * Receiving-related order operations — close orders after receipt.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems, requestItemAttributes } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { rollupRequestStatus } from "@/lib/services/item-state-module/rollup"

/* ── Close order (supplier_confirmed/partially_received/received → closed) ────── */

export async function closeOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Se requiere un motivo para cerrar la orden")

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["supplier_confirmed", "partially_received", "received"].includes(order.status)) {
      throw new Error(`No se puede cerrar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "closed", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    const linkedItems = await tx
      .select({
        orderItemId: purchaseOrderItems.id,
        requestItemId: purchaseOrderItems.requestItemId,
        ordered: purchaseOrderItems.quantity,
        received: purchaseOrderItems.quantityReceived,
        productId: purchaseRequestItems.productId,
        productNameFree: purchaseRequestItems.productNameFree,
        currentQuantity: purchaseRequestItems.quantity,
        unitOfMeasure: purchaseRequestItems.unitOfMeasure,
        currentStatus: purchaseRequestItems.status,
        requestId: purchaseRequestItems.requestId,
        urgency: purchaseRequestItems.urgency,
        requiredDate: purchaseRequestItems.requiredDate,
        workerId: purchaseRequestItems.workerId,
        suggestedSupplierId: purchaseRequestItems.suggestedSupplierId,
        supplierHint: purchaseRequestItems.supplierHint,
        sortOrder: purchaseRequestItems.sortOrder,
        notes: purchaseRequestItems.notes,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const unresolvedItems = linkedItems.filter((item) =>
      item.requestItemId
      && item.received <= 0
      && ["in_purchase_order", "purchased"].includes(item.currentStatus),
    )

    if (unresolvedItems.length > 0) {
      const unresolvedIds = unresolvedItems.map((item) => item.requestItemId!)
      await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(and(
          inArray(purchaseRequestItems.id, unresolvedIds),
          inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
        ))

      for (const item of unresolvedItems) {
        await recordStatusChange({
          entityType: "request_item",
          entityId: item.requestItemId!,
          fromStatus: item.currentStatus,
          toStatus: "pending_purchase",
          changedBy: userId,
          reason,
        }, tx)
      }
    }

    const partiallyReceivedItems = linkedItems.filter((item) =>
      item.requestItemId
      && item.received > 0
      && item.received < item.currentQuantity
      && ["partially_received", "partially_delivered", "received"].includes(item.currentStatus),
    )

    for (const item of partiallyReceivedItems) {
      const remaining = item.currentQuantity - item.received
      if (remaining <= 0) continue

      const splitItemId = nanoid()
      await tx
        .update(purchaseRequestItems)
        .set({ quantity: item.received, updatedAt: now })
        .where(eq(purchaseRequestItems.id, item.requestItemId!))

      await tx.insert(purchaseRequestItems).values({
        id: splitItemId,
        requestId: item.requestId,
        productId: item.productId,
        productNameFree: item.productNameFree,
        quantity: remaining,
        unitOfMeasure: item.unitOfMeasure,
        status: "pending_purchase",
        urgency: item.urgency,
        requiredDate: item.requiredDate,
        workerId: item.workerId,
        suggestedSupplierId: item.suggestedSupplierId,
        supplierHint: item.supplierHint,
        sortOrder: item.sortOrder + 1,
        notes: item.notes,
        createdAt: now,
        updatedAt: now,
      })

      const attrs = await tx
        .select({
          attributeId: requestItemAttributes.attributeId,
          attributeName: requestItemAttributes.attributeName,
          value: requestItemAttributes.value,
        })
        .from(requestItemAttributes)
        .where(eq(requestItemAttributes.requestItemId, item.requestItemId!))

      if (attrs.length > 0) {
        await tx.insert(requestItemAttributes).values(attrs.map((attr) => ({
          id: nanoid(),
          requestItemId: splitItemId,
          attributeId: attr.attributeId,
          attributeName: attr.attributeName,
          value: attr.value,
        })))
      }

      await recordStatusChange({
        entityType: "request_item",
        entityId: splitItemId,
        fromStatus: null,
        toStatus: "pending_purchase",
        changedBy: userId,
        reason,
      }, tx)
      await recordAudit({
        userId,
        userEmail: opts?.userEmail,
        action: "create",
        entityType: "request_item",
        entityId: splitItemId,
        newState: {
          status: "pending_purchase",
          splitFromItemId: item.requestItemId,
          quantity: remaining,
        },
        reason,
      }, tx)
    }

    const affectedRequestIds = [...new Set(linkedItems.map((item) => item.requestId))]
    for (const requestId of affectedRequestIds) {
      await rollupRequestStatus(requestId, tx)
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "closed",
      changedBy:  userId,
      reason,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "closed" },
      reason,
    }, tx)
  })
}
