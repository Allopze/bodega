/**
 * Item State Machine
 *
 * Hard rule: State transitions live here, never in UI components or Server Actions.
 * Each function validates the transition with canTransition(), then writes the DB
 * change + recordAudit() + recordStatusChange() inside a single db.transaction().
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** All valid states for a purchase request item */
export type ItemStatus =
  | "draft"
  | "requested"
  | "approved"
  | "rejected"
  | "returned"
  | "postponed"
  | "pending_purchase"
  | "in_purchase_order"
  | "purchased"
  | "partially_received"
  | "received"
  | "partially_delivered"
  | "delivered"

/** Valid terminal states (no further transitions expected) */
export const TERMINAL_STATES: ItemStatus[] = [
  "rejected",
  "delivered",
  "postponed",
]

/** State transition map — which transitions are allowed from each state */
export const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  draft:              ["requested"],
  requested:          ["approved", "rejected", "returned"],
  approved:           ["rejected", "pending_purchase"],
  rejected:           [],
  returned:           ["requested"],
  postponed:          ["pending_purchase"],
  pending_purchase:   ["in_purchase_order", "postponed"],
  in_purchase_order:  ["purchased", "pending_purchase"],
  purchased:          ["partially_received", "received"],
  partially_received: ["received"],
  received:           ["partially_delivered", "delivered"],
  partially_delivered:["delivered"],
  delivered:          [],
}

/** Check if a state transition is valid */
export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function getDeliveryTargetStatus(itemQuantity: number, totalDelivered?: number): ItemStatus {
  return totalDelivered !== undefined && totalDelivered < itemQuantity
    ? "partially_delivered"
    : "delivered"
}

// ── Phase 3 ─────────────────────────────────────────────────────────────────

/** Transition a draft item to requested status. */
export async function submitItem(
  itemId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  db.transaction((tx) => {
    submitItemTx(tx, itemId, userId, opts)
  })
}

export function submitItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { userEmail?: string },
): void {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "requested")) {
      throw new Error(`Cannot transition item from '${item.status}' to 'requested'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: "requested", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "requested",
      changedBy:  userId,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      newState:   { status: "requested" },
    }, tx)
}

// ── Phase 4 ─────────────────────────────────────────────────────────────────

/**
 * Approve an item: requested → approved → pending_purchase.
 * Optional modifiedQty lets the approver adjust the quantity before approving.
 * After the transition, rolls up the parent request status.
 */
export async function approveItem(
  itemId: string,
  userId: string,
  opts?: { modifiedQty?: number; userEmail?: string; roleContext?: string },
): Promise<void> {
  db.transaction((tx) => {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "approved")) {
      throw new Error(`Cannot approve item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    const updates: Partial<typeof purchaseRequestItems.$inferSelect> = {
      status:    "approved",
      updatedAt: now,
    }
    if (opts?.modifiedQty !== undefined) {
      updates.quantity = opts.modifiedQty
    }

    tx
      .update(purchaseRequestItems)
      .set(updates)
      .where(eq(purchaseRequestItems.id, itemId)).run()

    tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          opts?.modifiedQty !== undefined ? "modify" : "approve",
      decidedBy:     userId,
      modifiedQty:   opts?.modifiedQty ?? null,
      roleContext:   opts?.roleContext ?? null,
    }).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "approved",
      changedBy:  userId,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "approved", modifiedQty: opts?.modifiedQty },
    }, tx)

    rollupRequestStatus(item.requestId, tx)
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

  db.transaction((tx) => {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "rejected")) {
      throw new Error(`Cannot reject item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: "rejected", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          "reject",
      decidedBy:     userId,
      reason,
      roleContext:   opts?.roleContext ?? null,
    }).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "rejected",
      changedBy:  userId,
      reason,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "rejected" },
      reason,
    }, tx)

    rollupRequestStatus(item.requestId, tx)
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

  db.transaction((tx) => {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "returned")) {
      throw new Error(`Cannot return item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: "returned", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    tx.insert(approvalDecisions).values({
      id:            nanoid(),
      requestItemId: itemId,
      requestId:     item.requestId,
      type:          "return",
      decidedBy:     userId,
      reason,
      roleContext:   opts?.roleContext ?? null,
    }).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "returned",
      changedBy:  userId,
      reason,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "returned" },
      reason,
    }, tx)

    rollupRequestStatus(item.requestId, tx)
  })
}

/**
 * Roll up purchase request status based on current item statuses.
 * Called inside transactions after each item transition.
 *
 * Logic follows the current simple flow:
 *   - any requested item            → "in_review"
 *   - all items rejected            → "rejected"
 *   - all non-rejected items received → "closed"
 *   - any item in OC/purchased/received → "in_purchasing"
 *   - otherwise, approved/rejected decisions roll up to "approved"
 */
function rollupRequestStatus(
  requestId: string,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle transaction type is complex
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): void {
  const items = tx
    .select({ status: purchaseRequestItems.status })
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.requestId, requestId))
    .all()

  if (items.length === 0) return

  const statuses = items.map((i) => i.status)

  // Items still pending a decision
  const pendingReview = ["requested"].some((s) => statuses.includes(s))
  const anyApproved   = statuses.some((s) => ["approved", "pending_purchase", "in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"].includes(s))
  const allRejected   = statuses.every((s) => s === "rejected")
  const allReturned   = statuses.every((s) => s === "returned")
  const allClosed     = statuses.every((s) => ["received", "rejected"].includes(s))
  const anyPurchasing = statuses.some((s) => ["in_purchase_order", "purchased", "partially_received", "received"].includes(s))
  const allResolved   = !pendingReview

  let newStatus: string
  if (pendingReview) {
    newStatus = "in_review"
  } else if (allRejected) {
    newStatus = "rejected"
  } else if (allReturned) {
    newStatus = "returned"
  } else if (allClosed) {
    newStatus = "closed"
  } else if (anyPurchasing) {
    newStatus = "in_purchasing"
  } else if (allResolved && anyApproved) {
    const allApprovedOrBeyond = statuses.every((s) =>
      ["approved", "pending_purchase", "in_purchase_order", "purchased",
       "partially_received", "received", "partially_delivered", "delivered",
       "rejected"].includes(s)
    )
    newStatus = allApprovedOrBeyond ? "approved" : "partially_approved"
  } else if (allResolved) {
    newStatus = "partially_approved"
  } else {
    newStatus = "in_review"
  }

  const now = new Date().toISOString()
  tx
    .update(purchaseRequests)
    .set({ status: newStatus, updatedAt: now })
    .where(
      and(
        eq(purchaseRequests.id, requestId),
        // Only advance from submitted/in_review — don't regress from "in_purchasing" etc.
        inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved", "approved", "rejected", "returned", "in_purchasing", "closed"]),
      ),
    ).run()
}

// ── Phase 5 ─────────────────────────────────────────────────────────────────

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
  db.transaction((tx) => {
    addItemToPurchaseOrderTx(tx, itemId, orderId, userId, opts)
  })
}

export function addItemToPurchaseOrderTx(
  tx: Tx,
  itemId: string,
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): void {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)

    const now = new Date().toISOString()

    // Two-step if still in approved state
    if (item.status === "approved") {
      if (!canTransition("approved", "pending_purchase")) {
        throw new Error(`Cannot move item from 'approved' to 'pending_purchase'`)
      }
      tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(eq(purchaseRequestItems.id, itemId)).run()

      recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: "approved",
        toStatus:   "pending_purchase",
        changedBy:  userId,
      }, tx)
    }

    // Now transition to in_purchase_order
    const currentStatus = item.status === "approved" ? "pending_purchase" : item.status as ItemStatus
    if (!canTransition(currentStatus, "in_purchase_order")) {
      throw new Error(`Cannot move item from '${currentStatus}' to 'in_purchase_order'`)
    }

    tx
      .update(purchaseRequestItems)
      .set({ status: "in_purchase_order", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: currentStatus,
      toStatus:   "in_purchase_order",
      changedBy:  userId,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      newState:   { status: "in_purchase_order", orderId },
    }, tx)

    rollupRequestStatus(item.requestId, tx)
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
  db.transaction((tx) => {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "pending_purchase")) {
      throw new Error(`Cannot move item from '${item.status}' to 'pending_purchase'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: "pending_purchase", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "pending_purchase",
      changedBy:  userId,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "pending_purchase" },
    }, tx)
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

  db.transaction((tx) => {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)
    if (!canTransition(item.status as ItemStatus, "postponed")) {
      throw new Error(`Cannot postpone item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: "postponed", updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   "postponed",
      changedBy:  userId,
      reason,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: "postponed" },
      reason,
    }, tx)
  })
}

// ── Phase 6 ─────────────────────────────────────────────────────────────────

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
  db.transaction((tx) => {
    receiveItemTx(tx, itemId, userId, opts)
  })
}

export function receiveItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { fullReceived?: boolean; userEmail?: string },
): void {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)

    const targetStatus = opts?.fullReceived === false ? "partially_received" : "received"

    // Allow transition from purchased or partially_received
    const allowedFrom: ItemStatus[] = ["purchased", "partially_received"]
    if (!allowedFrom.includes(item.status as ItemStatus)) {
      throw new Error(`Cannot receive item in state '${item.status}'`)
    }
    if (!canTransition(item.status as ItemStatus, targetStatus as ItemStatus)) {
      throw new Error(`Cannot transition item from '${item.status}' to '${targetStatus}'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: item.status,
      toStatus:   targetStatus,
      changedBy:  userId,
    }, tx)
    recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: targetStatus },
    }, tx)

    rollupRequestStatus(item.requestId, tx)
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
  db.transaction((tx) => {
    deliverItemTx(tx, itemId, userId, opts)
  })
}

export function deliverItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { userEmail?: string; deliveredQuantity?: number; totalDelivered?: number },
): void {
    const item = tx.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, itemId),
    }).sync()
    if (!item) throw new Error(`Item ${itemId} not found`)

    const targetStatus = getDeliveryTargetStatus(item.quantity, opts?.totalDelivered)

    const statusChanged = item.status !== targetStatus
    if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
      throw new Error(`Cannot deliver item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId)).run()

    if (statusChanged) {
      recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: item.status,
        toStatus:   targetStatus,
        changedBy:  userId,
      }, tx)
    }
    recordAudit({
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

    rollupRequestStatus(item.requestId, tx)
}
