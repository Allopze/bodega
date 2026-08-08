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
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { RECEIVABLE_ORDER_STATUSES } from "@/lib/work-queue"
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
  /**
   * Faenas con actividad, ordenadas por inversión. `pendingCount` y
   * `approvedCount` salieron junto con sus dos queries de agregación: nadie las
   * leía —el único consumidor, `WorksiteActivityChart`, las mapeaba a un `data`
   * sin serie que las dibujara— y se calculaban en el `Promise.all` que bloquea
   * el Centro de Control. `requestsCount` se queda porque decide el filtro.
   */
  worksitesBreakdown: {
    id: string
    name: string
    requestsCount: number
    totalCost: number
  }[]
}

// ── Dashboard data (metrics + breakdown) ──────────────────────────────────────

export async function getDashboardData(session: Session, worksiteId?: string): Promise<DashboardData> {
  // `requestWorksiteFilter` e `itemWorksiteFilter` eran dos constantes idénticas
  // (misma columna, misma lógica). Ahora es una, y las tres salen del helper
  // compartido que además intersecta la faena del alcance global.
  const requestWorksiteFilter = worksiteScopeSql(session, purchaseRequests.worksiteId, worksiteId)
  const orderWorksiteFilter = worksiteScopeSql(session, purchaseOrders.worksiteId, worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id, worksiteId)
  const worksiteRowsFilter = and(eq(worksites.isActive, true), worksiteScope)

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
        requestWorksiteFilter,
        eq(purchaseRequestItems.status, "requested"),
      )),

    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(and(
        orderWorksiteFilter,
        inArray(purchaseOrders.status, RECEIVABLE_ORDER_STATUSES),
      )),

    db
      .select({
        id:             worksites.id,
        name:           worksites.name,
        requestsCount:  count(purchaseRequests.id),
      })
      .from(worksites)
      // El predicado de faena de `purchase_requests` va en el `ON` y no en el
      // `WHERE`: en un LEFT JOIN, filtrar la tabla derecha desde el `WHERE` lo
      // degrada a INNER y borra las faenas sin solicitudes. Con una sola faena
      // elegida eso hacía desaparecer la fila entera —y con ella su inversión—
      // cuando la faena todavía no tenía ninguna solicitud.
      .leftJoin(purchaseRequests, and(
        eq(purchaseRequests.worksiteId, worksites.id),
        requestWorksiteFilter,
      ))
      .where(worksiteRowsFilter)
      .groupBy(worksites.id, worksites.name)
      .orderBy(desc(count(purchaseRequests.id))),
  ])

  const metrics: Record<MetricKey, number> = {
    pending_approvals:      pendingApprovalsRow?.n ?? 0,
    orders_pending_receipt: ordersPendingReceiptRow?.n ?? 0,
  }

  const worksiteIds = worksiteBreakdownRows.map((w) => w.id)
  const orderCostRows = worksiteIds.length > 0
    ? await db
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
    : []

  const costMap = new Map(orderCostRows.map((r) => [r.worksiteId, r.totalCost]))

  const worksitesBreakdown = worksiteBreakdownRows
    .map((w) => ({
      id:            w.id,
      name:          w.name,
      requestsCount: w.requestsCount,
      // `Number(...)`: SUM(NUMERIC) llega como string del driver (I-01).
      totalCost:     Number(costMap.get(w.id) ?? 0),
    }))
    .filter((w) => w.requestsCount > 0 || w.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  return {
    metrics,
    worksitesBreakdown,
  }
}
