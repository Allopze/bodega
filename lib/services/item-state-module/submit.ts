import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canTransition, type ItemStatus } from "./types"

/** Transition a draft item to requested status. */
export async function submitItem(
  itemId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await submitItemTx(tx, itemId, userId, opts)
  })
}

export async function submitItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
    const [item] = await tx
      .select({ id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "requested")) {
      throw new Error(`Cannot transition item from '${item.status}' to 'requested'`)
    }

    const now = new Date().toISOString()
    const [updated] = await tx
      .update(purchaseRequestItems)
      .set({ status: "requested", updatedAt: now })
      .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, item.status)))
      .returning({ id: purchaseRequestItems.id })
    if (!updated) throw new Error("El ítem ya no está disponible: posible concurrencia")

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "requested",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      newState:   { status: "requested" },
    }, tx)
}
