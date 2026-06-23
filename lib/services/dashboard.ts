/**
 * Dashboard data-loading helpers.
 *
 * Extracted from app/(app)/dashboard/page.tsx to reduce file size
 * and make the data layer testable.
 */

import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  products,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import type { Session } from "next-auth"
import type {
  WorkActor,
  WorkQueueSnapshot,
  WorkRequestRow,
  WorkItemRow,
  WorkOrderRow,
} from "@/lib/work-queue"

// ── Metric key type ───────────────────────────────────────────────────────────

export type MetricKey =
  | "my_requests"
  | "pending_approvals"
  | "approved_without_oc"
  | "orders_in_progress"
  | "orders_pending_receipt"

// ── Dashboard data shape ──────────────────────────────────────────────────────

export interface DashboardData {
  metrics: Record<MetricKey, number>
  summary: {
    totalCosts: number
    totalRequests: number
    approvedRequests: number
  }
  worksitesBreakdown: {
    id: string
    name: string
    requestsCount: number
    pendingCount: number
    approvedCount: number
    totalCost: number
  }[]
}

// ── Snapshot query constants ──────────────────────────────────────────────────

const ACTIVE_REQUEST_STATUSES_SNAPSHOT = [
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "returned", "in_purchasing",
]
const ACTIVE_ITEM_STATUSES_SNAPSHOT = [
  "requested", "approved", "pending_purchase",
  "received", "partially_delivered",
]
const ACTIVE_ORDER_STATUSES_SNAPSHOT = [
  "draft", "issued", "sent", "supplier_confirmed",
  "partially_office_received", "office_received", "partially_received",
]
const SNAPSHOT_LIMIT = 200

// ── Work queue snapshot ───────────────────────────────────────────────────────

export async function getWorkQueueSnapshot(session: Session): Promise<WorkQueueSnapshot> {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`)

  const [
    requestRows,
    itemRows,
    orderRows,
    stockRows,
  ] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        worksiteName: worksites.name,
        requesterId:  purchaseRequests.requesterId,
        status:       purchaseRequests.status,
        urgency:      purchaseRequests.urgency,
        createdAt:    purchaseRequests.createdAt,
        submittedAt:  purchaseRequests.submittedAt,
      })
      .from(purchaseRequests)
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        requestWorksiteFilter,
        inArray(purchaseRequests.status, ACTIVE_REQUEST_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        id:              purchaseRequestItems.id,
        requestId:       purchaseRequestItems.requestId,
        requestCode:     purchaseRequests.code,
        worksiteId:      purchaseRequests.worksiteId,
        worksiteName:    worksites.name,
        requesterId:     purchaseRequests.requesterId,
        productName:     products.name,
        productNameFree: purchaseRequestItems.productNameFree,
        productId:       purchaseRequestItems.productId,
        status:          purchaseRequestItems.status,
        urgency:         purchaseRequestItems.urgency,
        createdAt:       purchaseRequestItems.createdAt,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(and(
        itemWorksiteFilter,
        inArray(purchaseRequestItems.status, ACTIVE_ITEM_STATUSES_SNAPSHOT),
      ))
      .limit(SNAPSHOT_LIMIT),

    // P-02: item count folded into orders query via scalar subquery to
    // eliminate the separate orderItemCounts query (N+1 pattern).
    db
      .select({
        id:           purchaseOrders.id,
        code:         purchaseOrders.code,
        worksiteId:   purchaseOrders.worksiteId,
        worksiteName: worksites.name,
        supplierName: suppliers.name,
        status:       purchaseOrders.status,
        createdAt:    purchaseOrders.createdAt,
        issuedAt:     purchaseOrders.issuedAt,
        sentAt:       purchaseOrders.sentAt,
        totalAmount:  purchaseOrders.totalAmount,
        itemCount:    sql<number>`(SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = ${purchaseOrders.id})`,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(
        orderWorksiteFilter,
        inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        productId: worksiteStock.productId,
      })
      .from(worksiteStock)
      .where(sql`${worksiteStock.quantity} > 0`),
  ])

  const itemStatusesByRequest = new Map<string, string[]>()
  for (const item of itemRows) {
    const statuses = itemStatusesByRequest.get(item.requestId) ?? []
    statuses.push(item.status)
    itemStatusesByRequest.set(item.requestId, statuses)
  }

  const itemCountByRequest = new Map<string, number>()
  for (const item of itemRows) {
    itemCountByRequest.set(item.requestId, (itemCountByRequest.get(item.requestId) ?? 0) + 1)
  }

  const stockProductIds = new Set(stockRows.map((row) => row.productId))

  const requests: WorkRequestRow[] = requestRows.map((request) => ({
    ...request,
    itemCount:    itemCountByRequest.get(request.id) ?? 0,
    itemStatuses: itemStatusesByRequest.get(request.id) ?? [],
  }))

  const items: WorkItemRow[] = itemRows.map((item) => ({
    id:            item.id,
    requestId:     item.requestId,
    requestCode:   item.requestCode,
    worksiteId:    item.worksiteId,
    worksiteName:  item.worksiteName,
    requesterId:   item.requesterId,
    productName:   item.productName ?? item.productNameFree ?? "Ítem solicitado",
    status:        item.status,
    urgency:       item.urgency,
    createdAt:     item.createdAt,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    hasStock:      item.productId ? stockProductIds.has(item.productId) : false,
  }))

  const orders: WorkOrderRow[] = orderRows.map((order) => ({
    ...order,
    itemCount: order.itemCount,
  }))

  return { requests, items, orders }
}

// ── Dashboard data (metrics + breakdown) ──────────────────────────────────────

export async function getDashboardData(session: Session): Promise<DashboardData> {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`)
  const worksiteRowsFilter = isGlobal ? eq(worksites.isActive, true) : (wsIds.length > 0 ? and(eq(worksites.isActive, true), inArray(worksites.id, wsIds)) : sql`false`)

  const [
    [myRequestsRow],
    [pendingApprovalsRow],
    [approvedWithoutOcRow],
    [ordersInProgressRow],
    [ordersPendingReceiptRow],
    [totalCostsRow],
    [totalRequestsRow],
    [approvedRequestsRow],
    worksiteBreakdownRows,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(and(
        requestWorksiteFilter,
        eq(purchaseRequests.requesterId, session.user.id),
        sql`${purchaseRequests.status} != 'cancelled'`,
      )),

    db
      .select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        itemWorksiteFilter,
        eq(purchaseRequestItems.status, "requested"),
      )),

    db
      .select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        itemWorksiteFilter,
        sql`${purchaseRequestItems.status} IN ('approved', 'pending_purchase')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} IN ('issued', 'sent', 'supplier_confirmed', 'partially_office_received', 'office_received', 'partially_received')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} IN ('sent', 'partially_office_received', 'office_received', 'partially_received')`,
      )),

    db
      .select({ n: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} NOT IN ('cancelled', 'draft')`,
      )),

    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(requestWorksiteFilter),

    db
      .select({ n: count() })
      .from(purchaseRequests)
      .where(and(
        requestWorksiteFilter,
        sql`${purchaseRequests.status} IN ('approved', 'closed', 'in_purchasing')`,
      )),

    db
      .select({
        id:             worksites.id,
        name:           worksites.name,
        requestsCount:  count(purchaseRequests.id),
      })
      .from(worksites)
      .leftJoin(purchaseRequests, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        worksiteRowsFilter,
        requestWorksiteFilter,
      ))
      .groupBy(worksites.id, worksites.name)
      .orderBy(desc(count(purchaseRequests.id))),
  ])

  const metrics: Record<MetricKey, number> = {
    my_requests:            myRequestsRow?.n ?? 0,
    pending_approvals:      pendingApprovalsRow?.n ?? 0,
    approved_without_oc:    approvedWithoutOcRow?.n ?? 0,
    orders_in_progress:     ordersInProgressRow?.n ?? 0,
    orders_pending_receipt: ordersPendingReceiptRow?.n ?? 0,
  }

  const totalCosts = totalCostsRow?.n ?? 0
  const totalRequests = totalRequestsRow?.n ?? 0
  const approvedRequests = approvedRequestsRow?.n ?? 0

  const worksiteIds = worksiteBreakdownRows.map((w) => w.id)
  const [orderCostRows, pendingItemRows, approvedRequestRows] = await Promise.all([
    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseOrders.worksiteId,
            totalCost:  sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
          })
          .from(purchaseOrders)
          .where(and(
            inArray(purchaseOrders.worksiteId, worksiteIds),
            sql`${purchaseOrders.status} NOT IN ('cancelled', 'draft')`,
          ))
          .groupBy(purchaseOrders.worksiteId)
      : Promise.resolve([]),

    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseRequests.worksiteId,
            n:          count(),
          })
          .from(purchaseRequestItems)
          .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .where(and(
            inArray(purchaseRequests.worksiteId, worksiteIds),
            eq(purchaseRequestItems.status, "requested"),
          ))
          .groupBy(purchaseRequests.worksiteId)
      : Promise.resolve([]),

    worksiteIds.length > 0
      ? db
          .select({
            worksiteId: purchaseRequests.worksiteId,
            n:          count(),
          })
          .from(purchaseRequests)
          .where(and(
            inArray(purchaseRequests.worksiteId, worksiteIds),
            sql`${purchaseRequests.status} IN ('approved', 'closed', 'in_purchasing')`,
          ))
          .groupBy(purchaseRequests.worksiteId)
      : Promise.resolve([]),
  ])

  const costMap = new Map(orderCostRows.map((r) => [r.worksiteId, r.totalCost]))
  const pendingMap = new Map(pendingItemRows.map((r) => [r.worksiteId, r.n]))
  const approvedMap = new Map(approvedRequestRows.map((r) => [r.worksiteId, r.n]))

  const worksitesBreakdown = worksiteBreakdownRows
    .map((w) => ({
      id:            w.id,
      name:          w.name,
      requestsCount: w.requestsCount,
      pendingCount:  pendingMap.get(w.id) ?? 0,
      approvedCount: approvedMap.get(w.id) ?? 0,
      totalCost:     costMap.get(w.id) ?? 0,
    }))
    .filter((w) => w.requestsCount > 0 || w.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  return {
    metrics,
    summary: {
      totalCosts,
      totalRequests,
      approvedRequests,
    },
    worksitesBreakdown,
  }
}

// ── Actor builder ─────────────────────────────────────────────────────────────

export function buildActor(session: Session): WorkActor {
  return {
    userId:      session.user.id,
    permissions: session.user.permissions,
    worksiteIds: session.user.worksiteIds,
    isGlobal:    isGlobalRole(session),
  }
}
