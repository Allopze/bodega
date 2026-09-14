/**
 * Comparativos mensuales para el centro operacional.
 *
 * Cada valor usa la fecha nativa del hecho (creación, emisión, recepción o
 * entrega). No se infiere una decisión histórica desde el estado actual.
 */
import { and, count, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { deliveries, purchaseOrders, purchaseRequests, receipts } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { getOperationalCalendarBounds, type OperationalPeriodSpan } from "./operational-period-bounds"

export { getOperationalCalendarBounds }
export type { OperationalPeriodSpan }

export type OperationalPeriodMetricKey = "requests" | "ordersIssued" | "receipts" | "deliveries" | "spend"

export interface OperationalPeriodMetric {
  current: number
  previous: number | null
}

export type OperationalPeriodMetrics = Record<OperationalPeriodMetricKey, OperationalPeriodMetric>

function dateKey(iso: string) {
  return iso.slice(0, 10)
}

// El predicado de faena (alcance del rol ∩ faena elegida) vive en
// `worksiteScopeSql`. Había una copia local de esta función acá, otra en
// `operational-trend-history.ts` y dos más en `dashboard-fleet-maintenance.ts`;
// agregar el parámetro de faena a las cuatro era la señal de que sobraban tres.

export function buildOperationalPeriodComparison(current: number, previous: number, hasHistory: number): OperationalPeriodMetric {
  // Un cero del mes anterior es un dato válido si existen registros previos.
  // Sin antecedentes anteriores no se declara una tendencia inexistente.
  return { current, previous: hasHistory > 0 ? previous : null }
}

export interface OperationalPeriodOptions {
  /** Ventana calendario a comparar. Por defecto el mes. */
  period?: OperationalPeriodSpan
  /** Faena única del alcance global del dashboard; sin ella, todas las autorizadas. */
  worksiteId?: string
  now?: Date
}

/** Flujos del período calendario en curso frente al período anterior. */
export async function getOperationalPeriodMetrics(session: Session, options: OperationalPeriodOptions = {}): Promise<OperationalPeriodMetrics> {
  const { period = "mes", worksiteId, now = new Date() } = options
  const bounds = getOperationalCalendarBounds(now, period)
  const requestScope = worksiteScopeSql(session, purchaseRequests.worksiteId, worksiteId)
  // DAT-16: una OC eliminada (soft-delete) no debe seguir contando en flujos
  // ni sumando en "gasto del período" — se filtra una sola vez aquí, ya que
  // orderScope alimenta todas las queries de OC/recepciones/gasto de abajo.
  const orderScope = and(isNull(purchaseOrders.deletedAt), worksiteScopeSql(session, purchaseOrders.worksiteId, worksiteId))
  const deliveryScope = worksiteScopeSql(session, deliveries.worksiteId, worksiteId)
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
    // `Number(...)`: el driver devuelve SUM(NUMERIC) como string aunque el tipo
    // diga `sql<number>`, y `formatCLP` responde "—" a un string (I-01).
    spend: buildOperationalPeriodComparison(Number(spendCurrent?.value ?? 0), Number(spendPrevious?.value ?? 0), Number(spendHistory?.value ?? 0)),
  }
}
