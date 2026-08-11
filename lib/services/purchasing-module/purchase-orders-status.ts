/**
 * Purchase order status transitions: issue+send (fused), cancel.
 * All DB mutations here, never in Server Actions or UI components.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange, recordStatusChanges } from "@/lib/audit"
import { lockRequestsForRollupTx, rollupRequestStatus } from "@/lib/services/item-state-module/rollup"
import {
  getActiveOrderedQuantitiesTx,
  lockPurchaseRequestItemsTx,
  PURCHASE_COVERAGE_EPSILON,
} from "./purchasable-coverage"

/* ── Emitir y enviar (draft → sent) ─────────────────────────────────────────────
 * Fusión 2026-08-07: "emitir" y "enviar al proveedor" eran dos pasos (draft →
 * issued → sent); el estado `issued` se retiró. issuedAt/issuedBy y sentAt se
 * registran juntos en la única transición. */

export async function issueAndSendOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (order.status !== "draft") {
      throw new Error(`Cannot issue and send order in state '${order.status}'`)
    }

    // A-03: an empty OC must never reach 'sent'. The receipt rollup keys off
    // OC items, so a 0-item order would otherwise sit in 'sent' forever.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
    if (ocItems.length === 0) {
      throw new Error("No se puede emitir y enviar una orden de compra sin ítems")
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", issuedAt: now, issuedBy: userId, sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move request items to "purchased" status
    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      // DAT-10: trazar sólo los ítems que la guarda realmente movió — si alguno
      // ya no estaba en 'in_purchase_order' (carrera con otra transición), la
      // guarda del WHERE no lo toca y el historial no debe fingir que sí.
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "purchased", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            eq(purchaseRequestItems.status, "in_purchase_order"),
          )
        )
        .returning({ id: purchaseRequestItems.id })

      await recordStatusChanges(
        updatedItems.map(({ id }) => ({
          entityType: "request_item" as const,
          entityId:   id,
          fromStatus: "in_purchase_order",
          toStatus:   "purchased",
          changedBy:  userId,
        })),
        tx,
      )
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "draft",
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
      oldState:   { status: "draft" },
      newState:   { status: "sent" },
    }, tx)
  })
}

/* ── Cancel Order (draft/sent → cancelled) ───────────────────────────────────── */

export async function cancelOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["draft", "sent"].includes(order.status)) {
      throw new Error(`Cannot cancel order in status '${order.status}'`)
    }

    const now = new Date().toISOString()

    // Lock the same source rows as createOrder, in a stable order, before
    // removing coverage. Otherwise a concurrent create could legitimately
    // cover the item and this cancellation would still reopen it afterwards.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)
    const lockedRequestItems = await lockPurchaseRequestItemsTx(tx, requestItemIds)
    // DAT-1: los padres, después de sus ítems y antes de devolverlos a la cola.
    await lockRequestsForRollupTx(tx, lockedRequestItems.map((item) => item.requestId))

    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

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
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"])
          )
        )
        .returning({ id: purchaseRequestItems.id })
      const updatedIds = new Set(updatedItems.map((item) => item.id))

      await recordStatusChanges(
        lockedRequestItems
          .filter((item) => updatedIds.has(item.id))
          .map((item) => ({
          entityType: "request_item" as const,
          entityId:   item.id,
          fromStatus: item.status,
          toStatus:   "pending_purchase",
          changedBy:  userId,
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

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}
