import type { Session } from "next-auth"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  approvalDecisions, deliveries, deliveryItems, purchaseOrderItems, purchaseOrders,
  purchaseRequestItems, purchaseRequests, receiptItems, receipts, worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { issuedOrderPredicate } from "@/lib/services/operational-period-metrics"
import { normalizeAnalyticsFilters, previousPeriod, worksiteFilter } from "./helpers"
import { buildSupplyLeadTime, type LeadTimeItem, type SupplyLeadTime } from "./lead-time-shape"
import type { AnalyticsFilters } from "./types"

/**
 * Plazos del ciclo de abastecimiento (CHART-029): cuántos días tarda cada tramo de
 * solicitud → aprobación → OC → llegada → entrega, sólo de los ítems **ya cerrados**.
 *
 * La consulta saca, por ítem cerrado, el día en que ocurrió cada hito; las medianas, el P90, el `n` y
 * la regla de «datos insuficientes» las calcula `buildSupplyLeadTime` (pura, con pruebas propias).
 *
 * **Alcance.** Es el mismo de sus hermanas en este módulo: la faena de la **solicitud** del ítem
 * (`worksiteFilter` sobre `purchase_requests.worksite_id`, intersectado con la faena elegida), y exige
 * `analytics:view`, el permiso de la pantalla que la muestra. No toca más tablas que las del ciclo ni
 * muestra más que fechas de ítems que el usuario ya puede ver en Seguimiento.
 *
 * **Qué es «cerrado».** El ítem llegó completo a faena (`received`) o se entregó (`delivered`), que es
 * donde la regla de cierre de solicitudes (`deriveRequestStatus`) da por terminada la adquisición. Un
 * `partially_delivered` queda fuera: el estado solo no distingue si llegó completo (ver el comentario
 * de `RollupItem`) y adivinarlo sesgaría la medición.
 *
 * **Cuándo se cerró.** Por el último movimiento del ítem: la mayor entre su última recepción y su
 * última entrega (sin contar anuladas). Ese día decide si entra al período.
 *
 * **Hitos** (todos en día civil de Chile, que es como se cuentan "días corridos" en el resto del producto):
 *  - envío: `purchase_requests.submitted_at` (texto ISO);
 *  - aprobación: primera decisión `approve`/`modify` del ítem;
 *  - OC: primera emisión de una OC viva que lo contiene (`issuedOrderPredicate`, la misma definición del
 *    tablero), con la línea no anulada;
 *  - llegada: primera recepción **no anulada** con cantidad recibida > 0;
 *  - entrega: primera entrega **no anulada** que lo incluye.
 */

const EPOCH = sql`date '1970-01-01'`

/** Día civil de Chile (desde 1970) de un instante `timestamptz`. */
const instantDay = (instant: SQL) => sql`((${instant} at time zone 'America/Santiago')::date - ${EPOCH})`

/**
 * Un texto de fecha (día o ISO) leído como instante. Un texto que no empieza con una fecha (vacío,
 * basura de una importación) no es un timestamp: sin la guarda el cast reventaría toda la consulta
 * por una sola fila. Misma razón y forma que `approvalAgeDaysSql` (Aprobaciones).
 */
const textInstant = (column: typeof purchaseRequests.submittedAt | typeof purchaseOrders.issuedAt) =>
  sql`(case when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then ${column}::timestamptz end)`

const submittedDay = instantDay(textInstant(purchaseRequests.submittedAt))

const approvedDay = sql`(select ${instantDay(sql`min(${approvalDecisions.decidedAt})`)} from ${approvalDecisions}
  where ${approvalDecisions.requestItemId} = ${purchaseRequestItems.id} and ${approvalDecisions.type} in ('approve', 'modify'))`

const issuedDay = sql`(select ${instantDay(sql`min(${textInstant(purchaseOrders.issuedAt)})`)} from ${purchaseOrderItems}
  inner join ${purchaseOrders} on ${purchaseOrders.id} = ${purchaseOrderItems.purchaseOrderId}
  where ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id} and ${purchaseOrderItems.status} <> 'cancelled' and ${issuedOrderPredicate()})`

/** Recepciones vigentes del ítem, a través de las líneas de OC que lo cubren. */
const arrival = (agg: "min" | "max") => sql`(select ${instantDay(sql`${sql.raw(agg)}(${receipts.receivedAt})`)} from ${receiptItems}
  inner join ${receipts} on ${receipts.id} = ${receiptItems.receiptId}
  inner join ${purchaseOrderItems} on ${purchaseOrderItems.id} = ${receiptItems.purchaseOrderItemId}
  where ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id} and ${receipts.status} <> 'voided' and ${receiptItems.quantityReceived} > 0)`

const delivery = (agg: "min" | "max") => sql`(select ${instantDay(sql`${sql.raw(agg)}(${deliveries.deliveredAt})`)} from ${deliveryItems}
  inner join ${deliveries} on ${deliveries.id} = ${deliveryItems.deliveryId}
  where ${deliveryItems.requestItemId} = ${purchaseRequestItems.id} and ${deliveries.voidedAt} is null)`

const closedDay = sql`greatest(${arrival("max")}, ${delivery("max")})`

/** Estados de ítem con los que la adquisición terminó. */
const CLOSED_ITEM_STATUSES = ["received", "delivered"]

const toDay = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export type SupplyLeadTimeResult = SupplyLeadTime & {
  filters: { fromDate: string; toDate: string; worksiteId?: string; requestType?: string }
}

export async function getSupplyLeadTime(session: Session, rawFilters: AnalyticsFilters = {}): Promise<SupplyLeadTimeResult> {
  if (!can(session, "analytics:view")) throw new Error("No autorizado")

  const filters = normalizeAnalyticsFilters(rawFilters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const windows = {
    current: [toDay(filters.fromDate), toDay(filters.toDate)] as const,
    previous: [toDay(previous.fromDate), toDay(previous.toDate)] as const,
  }

  const rows = await db.select({
    worksiteId: purchaseRequests.worksiteId,
    worksiteName: worksites.name,
    requestType: purchaseRequests.requestType,
    submittedDay: sql<number | null>`${submittedDay}`,
    approvedDay: sql<number | null>`${approvedDay}`,
    issuedDay: sql<number | null>`${issuedDay}`,
    arrivedDay: sql<number | null>`${arrival("min")}`,
    deliveredDay: sql<number | null>`${delivery("min")}`,
    closedDay: sql<number | null>`${closedDay}`,
  })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
    .where(and(
      worksiteFilter(session, purchaseRequests.worksiteId),
      filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
      filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined,
      inArray(purchaseRequestItems.status, CLOSED_ITEM_STATUSES),
      // Acota la lectura a las dos ventanas (período y comparación): el resto de la historia no hace falta.
      sql`${closedDay} between ${windows.previous[0]} and ${windows.current[1]}`,
    ))

  const items: LeadTimeItem[] = rows.map((row) => ({
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    requestType: row.requestType,
    submittedDay: num(row.submittedDay),
    approvedDay: num(row.approvedDay),
    issuedDay: num(row.issuedDay),
    arrivedDay: num(row.arrivedDay),
    deliveredDay: num(row.deliveredDay),
    closedDay: num(row.closedDay),
  }))

  return {
    ...buildSupplyLeadTime(items, windows),
    filters: {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      ...(filters.worksiteId ? { worksiteId: filters.worksiteId } : {}),
      ...(filters.requestType ? { requestType: filters.requestType } : {}),
    },
  }
}
