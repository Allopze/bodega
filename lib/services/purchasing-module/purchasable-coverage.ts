import { and, eq, inArray, isNull, ne, type SQL } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems } from "@/db/schema"

const PURCHASABLE_STATUSES = new Set(["approved", "pending_purchase"])
export const PURCHASE_COVERAGE_EPSILON = 0.000_001

export interface PurchasableRequestItem {
  id: string
  quantity: number
  status: string
}

export interface PurchaseCoverageLine {
  requestItemId: string | null
  quantity: number
  orderStatus: string
  orderItemStatus: string
  deletedAt: string | null
}

export interface PurchasableCoverage {
  requestItemId: string
  approvedQuantity: number
  activeOrderedQuantity: number
  remainingQuantity: number
  overcovered: boolean
  isPurchasable: boolean
}

function isActiveCoverageLine(line: PurchaseCoverageLine) {
  return line.requestItemId !== null
    && line.orderStatus !== "cancelled"
    && line.orderItemStatus !== "cancelled"
    && !line.deletedAt
}

/**
 * Computes the read model used by the purchasing picker and traceability.
 * A split purchase creates a sibling request item, so coverage is deliberately
 * calculated per persisted request item rather than across similarly named
 * products or a whole request family.
 */
export function getPurchasableCoverage(
  requestItems: readonly PurchasableRequestItem[],
  orderLines: readonly PurchaseCoverageLine[],
): PurchasableCoverage[] {
  const orderedByRequestItem = new Map<string, number>()

  for (const line of orderLines) {
    if (!isActiveCoverageLine(line) || !line.requestItemId) continue
    orderedByRequestItem.set(
      line.requestItemId,
      (orderedByRequestItem.get(line.requestItemId) ?? 0) + line.quantity,
    )
  }

  return requestItems.map((item) => {
    const activeOrderedQuantity = orderedByRequestItem.get(item.id) ?? 0
    const remainingQuantity = Math.max(0, item.quantity - activeOrderedQuantity)
    const overcovered = activeOrderedQuantity > item.quantity + PURCHASE_COVERAGE_EPSILON

    return {
      requestItemId: item.id,
      approvedQuantity: item.quantity,
      activeOrderedQuantity,
      remainingQuantity,
      overcovered,
      // Partial purchases are represented by a sibling request item. Reopening
      // the source item would create a second active order line over the same
      // source and turn a legacy inconsistency into an over-purchase.
      isPurchasable: PURCHASABLE_STATUSES.has(item.status)
        && activeOrderedQuantity <= PURCHASE_COVERAGE_EPSILON
        && remainingQuantity > PURCHASE_COVERAGE_EPSILON,
    }
  })
}

/**
 * Database predicate for the exact same active coverage used by the picker.
 * Keeping it here prevents lifecycle transitions from drifting from the read
 * model as cancellation, deletion and creation evolve independently.
 */
function activePurchaseCoverageCondition(requestItemCondition: SQL) {
  return and(
    requestItemCondition,
    ne(purchaseOrderItems.status, "cancelled"),
    ne(purchaseOrders.status, "cancelled"),
    isNull(purchaseOrders.deletedAt),
  )
}

export function activePurchaseCoverageWhere(requestItemId: string) {
  return activePurchaseCoverageCondition(eq(purchaseOrderItems.requestItemId, requestItemId))
}

export async function getActiveOrderedQuantityTx(tx: Tx, requestItemId: string): Promise<number> {
  const rows = await tx
    .select({ quantity: purchaseOrderItems.quantity })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .where(activePurchaseCoverageWhere(requestItemId))

  return rows.reduce((total, row) => total + row.quantity, 0)
}

/** Reads active coverage for several already-locked request items in one query. */
export async function getActiveOrderedQuantitiesTx(
  tx: Tx,
  requestItemIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(requestItemIds)]
  const totals = new Map<string, number>()
  if (ids.length === 0) return totals

  const rows = await tx
    .select({ requestItemId: purchaseOrderItems.requestItemId, quantity: purchaseOrderItems.quantity })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .where(activePurchaseCoverageCondition(inArray(purchaseOrderItems.requestItemId, ids)))

  for (const row of rows) {
    if (!row.requestItemId) continue
    totals.set(row.requestItemId, (totals.get(row.requestItemId) ?? 0) + row.quantity)
  }
  return totals
}

/**
 * Every mutation that can reopen an item takes this lock in lexical order.
 * Creation already locks one source item with the same row lock; a cancel or
 * delete therefore cannot put the item back into pending_purchase while a
 * competing active order is being created.
 */
export async function lockPurchaseRequestItemsTx(tx: Tx, requestItemIds: readonly string[]) {
  const ids = [...new Set(requestItemIds)].sort((a, b) => a.localeCompare(b))
  if (ids.length === 0) return []

  return tx
    .select({
      id: purchaseRequestItems.id,
      requestId: purchaseRequestItems.requestId,
      status: purchaseRequestItems.status,
    })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.id, ids))
    .orderBy(purchaseRequestItems.id)
    .for("update")
}
