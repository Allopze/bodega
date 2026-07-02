/**
 * Receiving-related order operations — close orders after receipt.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"

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
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
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
