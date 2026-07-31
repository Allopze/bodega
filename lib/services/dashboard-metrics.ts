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

// ── Metric key type ───────────────────────────────────────────────────────────

/**
 * Sólo las métricas que el dashboard consume. `my_requests`,
 * `approved_without_oc` y `orders_in_progress` se calculaban sin lector; se
 * borraron junto con `summary` (acumulados históricos que dejaron de usarse al
 * sacar los KPIs sin período — P-03 de la auditoría 2026-07-30).
 */
export type MetricKey =
  | "pending_approvals"
  | "orders_pending_receipt"

// ── Dashboard data shape ──────────────────────────────────────────────────────

export interface DashboardData {
  metrics: Record<MetricKey, number>
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
    [pendingApprovalsRow],
    [ordersPendingReceiptRow],
    worksiteBreakdownRows,
  ] = await Promise.all([
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
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        sql`${purchaseOrders.status} IN ('sent', 'partially_office_received', 'office_received', 'partially_received')`,
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
    pending_approvals:      pendingApprovalsRow?.n ?? 0,
    orders_pending_receipt: ordersPendingReceiptRow?.n ?? 0,
  }

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
    worksitesBreakdown,
  }
}
