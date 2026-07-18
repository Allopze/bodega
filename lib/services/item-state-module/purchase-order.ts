import { eq, and, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canTransition, type ItemStatus } from "./types"
import { rollupRequestStatus } from "./rollup"

/**
 * Add an approved (or pending_purchase) item to a purchase order.
 * Handles the two-step transition: approved → pending_purchase → in_purchase_order
 * if the item is still in the `approved` state.
 */
export async function addItemToPurchaseOrder(
  itemId: string,
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await addItemToPurchaseOrderTx(tx, itemId, orderId, userId, opts)
  })
}

export async function addItemToPurchaseOrderTx(
  tx: Tx,
  itemId: string,
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
    const now = new Date().toISOString()

    const [locked] = await tx
      .select({
        id:        purchaseRequestItems.id,
        status:    purchaseRequestItems.status,
        requestId: purchaseRequestItems.requestId,
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")

    if (!locked) {
      throw new Error(`Item ${itemId} not found`)
    }
    if (!["approved", "pending_purchase"].includes(locked.status)) {
      throw new Error(
        `El ítem ya no está disponible (estado: ${locked.status}) — posible concurrencia`,
      )
    }

    const [updated] = await tx
      .update(purchaseRequestItems)
      .set({ status: "in_purchase_order", updatedAt: now })
      .where(
        and(
          eq(purchaseRequestItems.id, itemId),
          inArray(purchaseRequestItems.status, ["approved", "pending_purchase"]),
        ),
      )
      .returning({ id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId })

    if (!updated) {
      throw new Error(
        `El ítem ya no está disponible — posible concurrencia`,
      )
    }

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: locked.status,
      toStatus:   "in_purchase_order",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      newState:   { status: "in_purchase_order", orderId },
    }, tx)

    await rollupRequestStatus(updated.requestId, tx)
}

/**
 * Move an approved item to pending_purchase to stage it for a future OC.
 * This is the intermediate holding state before the item gets added to an OC.
 */
export async function markItemPendingPurchase(
  itemId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "pending_purchase")) {
      throw new Error(`Cannot move item from '${item.status}' to 'pending_purchase'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: "pending_purchase", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "pending_purchase",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "pending_purchase" },
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
  })
}

/**
 * Postpone an item (approved or pending_purchase → postponed).
 * Reason is mandatory — this must be an explicit decision, never passive.
 */
export async function postponeItem(
  itemId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Reason is required to postpone an item")

  await db.transaction(async (tx) => {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "postponed")) {
      throw new Error(`Cannot postpone item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: "postponed", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "postponed",
      changedBy:  userId,
      reason,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "postponed" },
      reason,
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
  })
}
