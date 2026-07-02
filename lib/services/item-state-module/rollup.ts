import { eq, and, inArray } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"

/**
 * Roll up purchase request status based on current item statuses.
 * Called inside transactions after each item transition.
 */
export async function rollupRequestStatus(
  requestId: string,
  tx: Tx,
): Promise<void> {
  const items = await tx
    .select({ status: purchaseRequestItems.status })
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.requestId, requestId))

  if (items.length === 0) return

  const statuses = items.map((i) => i.status)

  const pendingReview = ["requested"].some((s) => statuses.includes(s))
  const anyApproved   = statuses.some((s) => ["approved", "pending_purchase", "in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"].includes(s))
  const allRejected   = statuses.every((s) => s === "rejected")
  const allReturned   = statuses.every((s) => s === "returned")
  const allClosed     = statuses.every((s) => ["received", "rejected", "delivered", "postponed"].includes(s))
  const anyPurchasing = statuses.some((s) => ["in_purchase_order", "purchased", "partially_received", "received", "partially_delivered"].includes(s))
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
       "rejected", "postponed"].includes(s)
    )
    newStatus = allApprovedOrBeyond ? "approved" : "partially_approved"
  } else if (allResolved) {
    newStatus = "partially_approved"
  } else {
    newStatus = "in_review"
  }

  const now = new Date().toISOString()
  await tx
    .update(purchaseRequests)
    .set({ status: newStatus, updatedAt: now })
    .where(
      and(
        eq(purchaseRequests.id, requestId),
        inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved", "approved", "rejected", "returned", "in_purchasing"]),
      ),
    )
}
