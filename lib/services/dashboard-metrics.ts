/**
 * Dashboard data-loading helpers.
 * Provides metrics, worksite breakdown, and actor builder for the dashboard.
 */

import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  worksites,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import type { Session } from "next-auth"
import type { WorkActor } from "@/lib/work-queue"

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
