import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequestItems, approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canTransition, type ItemStatus } from "./types"
import { rollupRequestStatus } from "./rollup"

/**
 * Bulk-approve multiple items in a single transaction.
 * Each item is locked individually (FOR UPDATE) to prevent deadlocks.
 * If any item fails, the entire transaction is rolled back.
 */
export async function bulkApproveItems(
  itemIds: string[],
  userId: string,
  opts?: { userEmail?: string; roleContext?: string },
): Promise<{ approved: number; errors: string[] }> {
  if (itemIds.length === 0) return { approved: 0, errors: [] }

  const approved: string[] = []
  const errors: string[] = []

  await db.transaction(async (tx) => {
    const now = new Date().toISOString()

    for (const itemId of itemIds) {
      try {
        const [locked] = await tx
          .select({ id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId })
          .from(purchaseRequestItems)
          .where(eq(purchaseRequestItems.id, itemId))
          .for("update")

        if (!locked) { errors.push(itemId); continue }
        if (!canTransition(locked.status as ItemStatus, "approved")) {
          errors.push(itemId); continue
        }

        const [updated] = await tx
          .update(purchaseRequestItems)
          .set({ status: "approved", updatedAt: now })
          .where(and(
            eq(purchaseRequestItems.id, itemId),
            eq(purchaseRequestItems.status, locked.status),
          ))
          .returning({ id: purchaseRequestItems.id })

        if (!updated) { errors.push(itemId); continue }

        await tx.insert(approvalDecisions).values({
          id:            nanoid(),
          requestItemId: itemId,
          requestId:     locked.requestId,
          type:          "approve",
          decidedBy:     userId,
          roleContext:   opts?.roleContext ?? null,
        })

        await recordStatusChange({
          entityType: "request_item",
          entityId:   itemId,
          fromStatus: locked.status,
          toStatus:   "approved",
          changedBy:  userId,
        }, tx)
        await recordAudit({
          userId,
          userEmail:  opts?.userEmail,
          action:     "status_change",
          entityType: "request_item",
          entityId:   itemId,
          oldState:   { status: locked.status },
          newState:   { status: "approved" },
        }, tx)

        approved.push(itemId)
      } catch {
        errors.push(itemId)
      }
    }

    // Roll up only affected requests (those with at least one successful approval)
    if (approved.length > 0) {
      const allItems = await tx
        .select({ requestId: purchaseRequestItems.requestId })
        .from(purchaseRequestItems)
        .where(inArray(purchaseRequestItems.id, approved))
      const uniqueRequestIds = [...new Set(allItems.map((i) => i.requestId))]
      for (const rid of uniqueRequestIds) {
        await rollupRequestStatus(rid, tx)
      }
    }
  })

  return { approved: approved.length, errors }
}

/** @see approveItem */
export async function approveItem(
  itemId: string,
  userId: string,
  opts?: { modifiedQty?: number; reason?: string; userEmail?: string; roleContext?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: purchaseRequestItems.id, status: purchaseRequestItems.status, requestId: purchaseRequestItems.requestId })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")

    if (!locked) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(locked.status as ItemStatus, "approved")) {
      throw new Error(`Cannot approve item in state '${locked.status}'`)
    }

    const now = new Date().toISOString()
    const updates: Partial<typeof purchaseRequestItems.$inferSelect> = {
      status:    "approved",
      updatedAt: now,
    }
    if (opts?.modifiedQty !== undefined) {
      updates.quantity = opts.modifiedQty
    }

    const [updated] = await tx
      .update(purchaseRequestItems)
      .set(updates)
      .where(
        and(
          eq(purchaseRequestItems.id, itemId),
          eq(purchaseRequestItems.status, locked.status),
        ),
      )
      .returning({ id: purchaseRequestItems.id })

    if (!updated) {
      throw new Error("El ítem ya no está disponible — posible concurrencia")
    }

    if (opts?.modifiedQty !== undefined && !opts?.reason) {
      throw new Error("Se requiere un motivo al modificar la cantidad aprobada")
    }

    await tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     locked.requestId,
      type:          opts?.modifiedQty !== undefined ? "modify" : "approve",
      decidedBy:     userId,
      reason:        opts?.reason ?? null,
      modifiedQty:   opts?.modifiedQty ?? null,
      roleContext:   opts?.roleContext ?? null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: locked.status,
      toStatus:   "approved",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: locked.status },
      newState:   { status: "approved", modifiedQty: opts?.modifiedQty },
    }, tx)

    await rollupRequestStatus(locked.requestId, tx)
  })
}

/**
 * Reject an item: requested → rejected. Reason is mandatory.
 * After the transition, rolls up the parent request status.
 */
export async function rejectItem(
  itemId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string; roleContext?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Reason is required to reject an item")

  await db.transaction(async (tx) => {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "rejected")) {
      throw new Error(`Cannot reject item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: "rejected", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    await tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          "reject",
      decidedBy:     userId,
      reason,
      roleContext:   opts?.roleContext ?? null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "rejected",
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
      newState:   { status: "rejected" },
      reason,
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
  })
}

/**
 * Return an item to the requester for correction: requested → returned.
 * Reason is mandatory (must explain what needs to change).
 * A returned item can be re-submitted after editing.
 */
export async function returnItem(
  itemId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string; roleContext?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Reason is required to return an item")

  await db.transaction(async (tx) => {
    const item = await tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    })
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "returned")) {
      throw new Error(`Cannot return item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: "returned", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    await tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          "return",
      decidedBy:     userId,
      reason,
      roleContext:   opts?.roleContext ?? null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "returned",
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
      newState:   { status: "returned" },
      reason,
    }, tx)

    await rollupRequestStatus(item.requestId, tx)
  })
}
