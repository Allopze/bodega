/**
 * Histórico de flujos operativos mensuales (últimos N meses).
 *
 * Proporciona datos de tendencia para el dashboard ejecutivo: solicitudes
 * creadas, OC emitidas, recepciones, entregas e inversión, agrupados
 * por mes calendario en timezone America/Santiago.
 *
 * A diferencia de `operational-period-metrics.ts` (que solo compara mes
 * actual vs anterior), este servicio retorna un array de N meses para
 * alimentar gráficos de tendencia con 6+ puntos de datos.
 */

import { and, count, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import { deliveries, purchaseOrders, purchaseRequests, receipts } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OperationalTrendPoint {
  /** Label corto del mes, e.g. "Ene", "Feb" */
  month: string
  /** ISO de inicio del mes (para ordenar) */
  monthStart: string
  requests: number
  orders: number
  receipts: number
  deliveries: number
  spend: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoStartOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString()
}

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

function scopeFilter(session: Session, column: AnyPgColumn) {
  if (isGlobalRole(session)) return undefined
  const worksiteIds = visibleWorksiteIds(session)
  return worksiteIds.length > 0 ? inArray(column, worksiteIds) : sql`false`
}

/** Genera los límites de N meses hacia atrás desde el mes actual en Santiago. */
function getMonthBounds(months: number, now = new Date()): Array<{ label: string; start: string; end: string }> {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
  }).formatToParts(now)
  const currentYear = Number(dateParts.find((part) => part.type === "year")?.value)
  const currentMonth = Number(dateParts.find((part) => part.type === "month")?.value) - 1

  const result: Array<{ label: string; start: string; end: string }> = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth()
    result.push({
      label: MONTH_LABELS[month] ?? `M${month + 1}`,
      start: isoStartOfMonth(year, month),
      end: isoStartOfMonth(year, month + 1),
    })
  }
  return result
}

// ── Main query ────────────────────────────────────────────────────────────────

/**
 * Últimos `months` meses de métricas operativas para gráficos de tendencia.
 *
 * Ejecuta una sola query agrupada por mes para cada métrica, en paralelo.
 * El resultado es un array ordenado cronológicamente con el mes más antiguo
 * primero, listo para pasar a un AreaChart / LineChart de Recharts.
 */
export async function getOperationalTrendHistory(
  session: Session,
  months = 6,
  now = new Date(),
): Promise<OperationalTrendPoint[]> {
  const bounds = getMonthBounds(months, now)
  const requestScope = scopeFilter(session, purchaseRequests.worksiteId)
  const orderScope = scopeFilter(session, purchaseOrders.worksiteId)
  const deliveryScope = scopeFilter(session, deliveries.worksiteId)

  const globalStart = bounds[0]!.start
  const globalEnd = bounds[bounds.length - 1]!.end

  // SQL para extraer año-mes en timezone Santiago
  const requestMonth = sql<string>`to_char(${purchaseRequests.createdAt}::timestamptz AT TIME ZONE 'America/Santiago', 'YYYY-MM')`
  const orderMonth = sql<string>`to_char(${purchaseOrders.issuedAt}::date, 'YYYY-MM')`
  const receiptMonth = sql<string>`to_char(${receipts.receivedAt}::timestamptz AT TIME ZONE 'America/Santiago', 'YYYY-MM')`
  const deliveryMonth = sql<string>`to_char(${deliveries.deliveredAt}::timestamptz AT TIME ZONE 'America/Santiago', 'YYYY-MM')`

  const [requestRows, orderRows, receiptRows, deliveryRows, spendRows] = await Promise.all([
    // Solicitudes creadas por mes
    db
      .select({ month: requestMonth, value: count() })
      .from(purchaseRequests)
      .where(and(
        requestScope,
        gte(purchaseRequests.createdAt, globalStart),
        lt(purchaseRequests.createdAt, globalEnd),
      ))
      .groupBy(requestMonth),

    // OC emitidas por mes
    db
      .select({ month: orderMonth, value: count() })
      .from(purchaseOrders)
      .where(and(
        orderScope,
        isNotNull(purchaseOrders.issuedAt),
        gte(purchaseOrders.issuedAt, dateKey(globalStart)),
        lt(purchaseOrders.issuedAt, dateKey(globalEnd)),
      ))
      .groupBy(orderMonth),

    // Recepciones por mes
    db
      .select({ month: receiptMonth, value: count() })
      .from(receipts)
      .innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
      .where(and(
        orderScope,
        gte(receipts.receivedAt, globalStart),
        lt(receipts.receivedAt, globalEnd),
      ))
      .groupBy(receiptMonth),

    // Entregas por mes
    db
      .select({ month: deliveryMonth, value: count() })
      .from(deliveries)
      .where(and(
        deliveryScope,
        gte(deliveries.deliveredAt, globalStart),
        lt(deliveries.deliveredAt, globalEnd),
      ))
      .groupBy(deliveryMonth),

    // Inversión emitida por mes
    db
      .select({
        month: orderMonth,
        value: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      })
      .from(purchaseOrders)
      .where(and(
        orderScope,
        isNotNull(purchaseOrders.issuedAt),
        gte(purchaseOrders.issuedAt, dateKey(globalStart)),
        lt(purchaseOrders.issuedAt, dateKey(globalEnd)),
      ))
      .groupBy(orderMonth),
  ])

  // Indexar los resultados por clave YYYY-MM
  const toMap = (rows: Array<{ month: string; value: number }>) =>
    new Map(rows.map((r) => [r.month, r.value]))

  const requestMap = toMap(requestRows)
  const orderMap = toMap(orderRows)
  const receiptMap = toMap(receiptRows)
  const deliveryMap = toMap(deliveryRows)
  const spendMap = toMap(spendRows)

  // Construir el array final, asegurando que cada mes tiene una entrada
  return bounds.map((bound) => {
    // Extraer YYYY-MM desde el ISO start
    const key = bound.start.slice(0, 7) // "2026-01"
    return {
      month: bound.label,
      monthStart: bound.start,
      requests: requestMap.get(key) ?? 0,
      orders: orderMap.get(key) ?? 0,
      receipts: receiptMap.get(key) ?? 0,
      deliveries: deliveryMap.get(key) ?? 0,
      spend: spendMap.get(key) ?? 0,
    }
  })
}
