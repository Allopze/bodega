import { eq, and, inArray } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { rollupRequestStatus } from "./rollup"

/**
 * Add an approved (or pending_purchase) item to a purchase order.
 * Handles the two-step transition: approved → pending_purchase → in_purchase_order
 * if the item is still in the `approved` state.
 */
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
        `El ítem ya no está disponible (estado: ${locked.status}): posible concurrencia`,
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
        `El ítem ya no está disponible: posible concurrencia`,
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

    await rollupRequestStatus(updated.requestId, tx, userId)
}

