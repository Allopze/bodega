import type { Session } from "next-auth"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { products, purchaseRequestItems, purchaseRequests, worksites } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { normalizeAnalyticsFilters, previousPeriod, worksiteFilter } from "./helpers"
import { leadTimeMilestoneSql } from "./lead-time-sql"
import {
  LEAD_TIME_CLOSED_ITEM_STATUSES, buildSupplyLeadTime, plainDateToDay,
  type LeadTimeItem, type SupplyLeadTime,
} from "./lead-time-shape"
import type { AnalyticsFilters } from "./types"

/**
 * Plazos del ciclo de abastecimiento (CHART-029): cuántos días tarda cada tramo de
 * solicitud → aprobación → OC → llegada → entrega, sólo de los ítems **ya cerrados**.
 *
 * La consulta saca, por ítem cerrado, el día en que ocurrió cada hito; las medianas, el P90, el `n` y
 * la regla de «datos insuficientes» las calcula `buildSupplyLeadTime` (pura, con pruebas propias). Los
 * hitos se definen en `lead-time-sql.ts`, que comparte con la ficha de un ítem (`lead-time-item.ts`).
 *
 * **Alcance.** Es el mismo de sus hermanas en este módulo: la faena de la **solicitud** del ítem
 * (`worksiteFilter` sobre `purchase_requests.worksite_id`, intersectado con la faena elegida), y exige
 * `analytics:view`, el permiso de la pantalla que la muestra. Los filtros **sólo acotan** y nunca
 * amplían: elegir una faena ajena deja cero ítems, no «todas».
 *
 * **Filtros.** Período, faena, tipo de solicitud y proveedor. El proveedor deja los ítems que tienen
 * una línea de OC viva emitida a ese proveedor, y mide la emisión y la llegada sobre esas líneas (ver
 * `lead-time-sql.ts`). El vehículo no aplica: el ciclo de abastecimiento no pasa por la flota.
 *
 * **Los más lentos.** Junto con las medianas sale la lista de los ítems cerrados que más tardaron, con
 * código de solicitud y producto. Es dato de ítems que el usuario ya ve en esta pantalla como agregado y
 * está acotado por el mismo alcance de faenas.
 *
 * **Qué es «cerrado».** Ver `LEAD_TIME_CLOSED_ITEM_STATUSES`. **Cuándo se cerró:** por el último
 * movimiento del ítem (la mayor entre su última recepción y su última entrega, sin contar anuladas);
 * ese día decide si entra al período.
 */

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export type SupplyLeadTimeFilters = Pick<AnalyticsFilters, "fromDate" | "toDate" | "worksiteId" | "supplierId" | "requestType">

export type SupplyLeadTimeResult = SupplyLeadTime & {
  filters: { fromDate: string; toDate: string; worksiteId?: string; supplierId?: string; requestType?: string }
}

export async function getSupplyLeadTime(session: Session, rawFilters: AnalyticsFilters = {}): Promise<SupplyLeadTimeResult> {
  if (!can(session, "analytics:view")) throw new Error("No autorizado")

  const filters = normalizeAnalyticsFilters(rawFilters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const windows = {
    current: [plainDateToDay(filters.fromDate), plainDateToDay(filters.toDate)] as const,
    previous: [plainDateToDay(previous.fromDate), plainDateToDay(previous.toDate)] as const,
  }
  const milestones = leadTimeMilestoneSql(filters.supplierId)

  const rows = await db.select({
    itemId: purchaseRequestItems.id,
    requestId: purchaseRequests.id,
    requestCode: purchaseRequests.code,
    productName: sql<string | null>`coalesce(${products.name}, ${purchaseRequestItems.productNameFree})`,
    worksiteId: purchaseRequests.worksiteId,
    worksiteName: worksites.name,
    requestType: purchaseRequests.requestType,
    submittedDay: sql<number | null>`${milestones.submittedDay}`,
    approvedDay: sql<number | null>`${milestones.approvedDay}`,
    issuedDay: sql<number | null>`${milestones.issuedDay}`,
    arrivedDay: sql<number | null>`${milestones.arrivedDay}`,
    deliveredDay: sql<number | null>`${milestones.deliveredDay}`,
    closedDay: sql<number | null>`${milestones.closedDay}`,
  })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .where(and(
      worksiteFilter(session, purchaseRequests.worksiteId),
      filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
      filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined,
      inArray(purchaseRequestItems.status, [...LEAD_TIME_CLOSED_ITEM_STATUSES]),
      // Con proveedor, sólo ítems que ese proveedor tuvo en una OC viva: sin emisión de él no hay plazo suyo.
      filters.supplierId ? sql`${milestones.issuedDay} is not null` : undefined,
      // Acota la lectura a las dos ventanas (período y comparación): el resto de la historia no hace falta.
      sql`${milestones.closedDay} between ${windows.previous[0]} and ${windows.current[1]}`,
    ))

  const items: LeadTimeItem[] = rows.map((row) => ({
    itemId: row.itemId,
    requestId: row.requestId,
    requestCode: row.requestCode,
    ...(row.productName ? { productName: row.productName } : {}),
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
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters.requestType ? { requestType: filters.requestType } : {}),
    },
  }
}
