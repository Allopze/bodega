import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canTransition, getDeliveryTargetStatus, type ItemStatus } from "./types"
import { rollupRequestStatus } from "./rollup"

/**
 * Transition a purchased item to received or partially_received.
 * Called from lib/services/receiving.ts after creating a receipt item.
 * fullReceived = true → "received", false → "partially_received"
 */
export async function receiveItem(
  itemId: string,
  userId: string,
  opts?: { fullReceived?: boolean; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await receiveItemTx(tx, itemId, userId, opts)
  })
}

export async function receiveItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { fullReceived?: boolean; userEmail?: string },
): Promise<void> {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)

    const allowedFrom: ItemStatus[] = ["purchased", "partially_received", "partially_delivered"]
    if (!allowedFrom.includes(item.status as ItemStatus)) {
      throw new Error(`Cannot receive item in state '${item.status}'`)
    }

    // Un ítem que ya salió en entrega parcial no retrocede cuando llega el saldo a
    // faena: conserva 'partially_delivered' y sólo se registra el ingreso.
    const targetStatus: ItemStatus = item.status === "partially_delivered"
      ? "partially_delivered"
      : opts?.fullReceived === false ? "partially_received" : "received"

    // Mismo guardia que deliverItemTx: la segunda recepción parcial apunta al estado
    // que el ítem ya tiene ('partially_received' → 'partially_received') y eso no es
    // una transición — ALLOWED_TRANSITIONS sólo describe avances.
    const statusChanged = item.status !== targetStatus
    if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
      throw new Error(`Cannot transition item from '${item.status}' to '${targetStatus}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    if (statusChanged) {
      await recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: item.status,
        toStatus:   targetStatus,
        changedBy:  userId,
      }, tx)
    }
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: targetStatus },
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
}

/**
 * Mark an item as delivered to faena (from warehouse dispatch).
 * Transitions received → delivered.
 */
export async function deliverItem(
  itemId: string,
  userId: string,
  opts?: { userEmail?: string; deliveredQuantity?: number; totalDelivered?: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await deliverItemTx(tx, itemId, userId, opts)
  })
}

export async function deliverItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { userEmail?: string; deliveredQuantity?: number; totalDelivered?: number },
): Promise<void> {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)

    const targetStatus = getDeliveryTargetStatus(item.quantity, opts?.totalDelivered)

    const statusChanged = item.status !== targetStatus
    if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
      throw new Error(`Cannot deliver item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    if (statusChanged) {
      await recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: item.status,
        toStatus:   targetStatus,
        changedBy:  userId,
      }, tx)
    }
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   {
        status: targetStatus,
        deliveredQuantity: opts?.deliveredQuantity,
        totalDelivered: opts?.totalDelivered,
      },
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
}
