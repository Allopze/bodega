/**
 * Comparativos mensuales para el centro operacional.
 *
 * Cada valor usa la fecha nativa del hecho (creación, emisión, recepción o
 * entrega). No se infiere una decisión histórica desde el estado actual.
 */
import { and, count, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import { deliveries, purchaseOrders, purchaseRequests, receipts } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

export type OperationalPeriodMetricKey = "requests" | "ordersIssued" | "receipts" | "deliveries" | "spend"

export interface OperationalPeriodMetric {
  current: number
  previous: number | null
}

export type OperationalPeriodMetrics = Record<OperationalPeriodMetricKey, OperationalPeriodMetric>

type PeriodBounds = {
  currentStart: string
  currentEnd: string
  previousStart: string
  previousEnd: string
}

function isoStartOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toISOString()
}

function dateKey(iso: string) {
  return iso.slice(0, 10)
}

export function getOperationalCalendarBounds(now = new Date()): PeriodBounds {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
  }).formatToParts(now)
  const year = Number(dateParts.find((part) => part.type === "year")?.value)
  const month = Number(dateParts.find((part) => part.type === "month")?.value) - 1
  const currentStart = isoStartOfMonth(year, month)
  const currentEnd = isoStartOfMonth(year, month + 1)
  return {
    currentStart,
    currentEnd,
    previousStart: isoStartOfMonth(year, month - 1),
    previousEnd: currentStart,
  }
}

function scopeFilter(session: Session, column: AnyPgColumn) {
  if (isGlobalRole(session)) return undefined
  const worksiteIds = visibleWorksiteIds(session)
  return worksiteIds.length > 0 ? inArray(column, worksiteIds) : sql`false`
}

export function buildOperationalPeriodComparison(current: number, previous: number, hasHistory: number): OperationalPeriodMetric {
  // Un cero del mes anterior es un dato válido si existen registros previos.
  // Sin antecedentes anteriores no se declara una tendencia inexistente.
  return { current, previous: hasHistory > 0 ? previous : null }
}

/** Flujos del mes calendario actual frente al mes calendario anterior. */
export async function getOperationalPeriodMetrics(session: Session, now = new Date()): Promise<OperationalPeriodMetrics> {
  const bounds = getOperationalCalendarBounds(now)
  const requestScope = scopeFilter(session, purchaseRequests.worksiteId)
  const orderScope = scopeFilter(session, purchaseOrders.worksiteId)
  const deliveryScope = scopeFilter(session, deliveries.worksiteId)
  const currentIssuedStart = dateKey(bounds.currentStart)
  const currentIssuedEnd = dateKey(bounds.currentEnd)
  const previousIssuedStart = dateKey(bounds.previousStart)
  const previousIssuedEnd = dateKey(bounds.previousEnd)

  const [
    [requestsCurrent], [requestsPrevious], [requestsHistory],
    [ordersCurrent], [ordersPrevious], [ordersHistory],
    [receiptsCurrent], [receiptsPrevious], [receiptsHistory],
    [deliveriesCurrent], [deliveriesPrevious], [deliveriesHistory],
    [spendCurrent], [spendPrevious], [spendHistory],
  ] = await Promise.all([
    db.select({ value: count() }).from(purchaseRequests).where(and(requestScope, gte(purchaseRequests.createdAt, bounds.currentStart), lt(purchaseRequests.createdAt, bounds.currentEnd))),
    db.select({ value: count() }).from(purchaseRequests).where(and(requestScope, gte(purchaseRequests.createdAt, bounds.previousStart), lt(purchaseRequests.createdAt, bounds.previousEnd))),
    db.select({ value: count() }).from(purchaseRequests).where(and(requestScope, lt(purchaseRequests.createdAt, bounds.previousEnd))),

    db.select({ value: count() }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), gte(purchaseOrders.issuedAt, currentIssuedStart), lt(purchaseOrders.issuedAt, currentIssuedEnd))),
    db.select({ value: count() }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), gte(purchaseOrders.issuedAt, previousIssuedStart), lt(purchaseOrders.issuedAt, previousIssuedEnd))),
    db.select({ value: count() }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), lt(purchaseOrders.issuedAt, previousIssuedEnd))),

    db.select({ value: count() }).from(receipts).innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id)).where(and(orderScope, gte(receipts.receivedAt, bounds.currentStart), lt(receipts.receivedAt, bounds.currentEnd))),
    db.select({ value: count() }).from(receipts).innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id)).where(and(orderScope, gte(receipts.receivedAt, bounds.previousStart), lt(receipts.receivedAt, bounds.previousEnd))),
    db.select({ value: count() }).from(receipts).innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id)).where(and(orderScope, lt(receipts.receivedAt, bounds.previousEnd))),

    db.select({ value: count() }).from(deliveries).where(and(deliveryScope, gte(deliveries.deliveredAt, bounds.currentStart), lt(deliveries.deliveredAt, bounds.currentEnd))),
    db.select({ value: count() }).from(deliveries).where(and(deliveryScope, gte(deliveries.deliveredAt, bounds.previousStart), lt(deliveries.deliveredAt, bounds.previousEnd))),
    db.select({ value: count() }).from(deliveries).where(and(deliveryScope, lt(deliveries.deliveredAt, bounds.previousEnd))),

    db.select({ value: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), gte(purchaseOrders.issuedAt, currentIssuedStart), lt(purchaseOrders.issuedAt, currentIssuedEnd))),
    db.select({ value: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), gte(purchaseOrders.issuedAt, previousIssuedStart), lt(purchaseOrders.issuedAt, previousIssuedEnd))),
    db.select({ value: count() }).from(purchaseOrders).where(and(orderScope, isNotNull(purchaseOrders.issuedAt), lt(purchaseOrders.issuedAt, previousIssuedEnd))),
  ])

  return {
    requests: buildOperationalPeriodComparison(requestsCurrent?.value ?? 0, requestsPrevious?.value ?? 0, requestsHistory?.value ?? 0),
    ordersIssued: buildOperationalPeriodComparison(ordersCurrent?.value ?? 0, ordersPrevious?.value ?? 0, ordersHistory?.value ?? 0),
    receipts: buildOperationalPeriodComparison(receiptsCurrent?.value ?? 0, receiptsPrevious?.value ?? 0, receiptsHistory?.value ?? 0),
    deliveries: buildOperationalPeriodComparison(deliveriesCurrent?.value ?? 0, deliveriesPrevious?.value ?? 0, deliveriesHistory?.value ?? 0),
    spend: buildOperationalPeriodComparison(spendCurrent?.value ?? 0, spendPrevious?.value ?? 0, spendHistory?.value ?? 0),
  }
}
