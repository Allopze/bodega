/**
 * Purchase order soft-delete.
 * Revierte los request items vinculados, renombra el código para liberar
 * la restricción UNIQUE, y marca deletedAt. No elimina archivos del disco
 * (se conservan para auditoría fiscal).
 */

import { eq, and, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange, recordStatusChanges } from "@/lib/audit"
import { isOrderDeletable } from "@/lib/services/purchasing.constants"
import { rollupRequestStatus } from "@/lib/services/item-state-module/rollup"
import {
  getActiveOrderedQuantitiesTx,
  lockPurchaseRequestItemsTx,
  PURCHASE_COVERAGE_EPSILON,
} from "./purchasable-coverage"

export async function deleteOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | "all" = "all",
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
      .for("update")
    if (!order) throw new Error(`Orden ${orderId} no encontrada`)
    if (worksiteIds !== "all" && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta orden")
    }
    if (!isOrderDeletable(order.status, order.deletedAt)) {
      throw new Error(`No se puede eliminar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()

    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)
    const lockedRequestItems = await lockPurchaseRequestItemsTx(tx, requestItemIds)

    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const deletedCode = `${order.code}-DELETED-${nanoid().slice(0, 8)}`
    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled", code: deletedCode, deletedAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    const activeCoverageByRequestItem = await getActiveOrderedQuantitiesTx(
      tx,
      lockedRequestItems.map((item) => item.id),
    )
    const uncoveredRequestItemIds: string[] = []
    for (const item of lockedRequestItems) {
      if ((activeCoverageByRequestItem.get(item.id) ?? 0) <= PURCHASE_COVERAGE_EPSILON) {
        uncoveredRequestItemIds.push(item.id)
      }
    }

    if (uncoveredRequestItemIds.length > 0) {
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, uncoveredRequestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
          ),
        )
        .returning({ id: purchaseRequestItems.id })
      const updatedIds = new Set(updatedItems.map((item) => item.id))

      await recordStatusChanges(
        lockedRequestItems
          .filter((item) => updatedIds.has(item.id))
          .map((item) => ({
            entityType: "request_item" as const,
            entityId: item.id,
            fromStatus: item.status,
            toStatus: "pending_purchase",
            changedBy: userId,
          })),
        tx,
      )
    }

    const affectedRequestIds = [...new Set(
      lockedRequestItems.map((item) => item.requestId),
    )]
    for (const rid of affectedRequestIds) {
      await rollupRequestStatus(rid, tx, userId)
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "cancelled",
      changedBy:  userId,
    }, tx)
    await recordAudit(
      {
        userId,
        userEmail:  opts?.userEmail,
        action:     "delete",
        entityType: "purchase_order",
        entityId:   orderId,
        entityCode: order.code,
        oldState:   { status: order.status },
        newState:   { status: "cancelled", deletedAt: now },
      },
      tx,
    )
  })
}
