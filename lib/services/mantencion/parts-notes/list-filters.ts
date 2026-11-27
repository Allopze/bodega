import { eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, users } from "@/db/schema"
import { escapeLikePattern } from "@/lib/utils"
import type { MantViewer } from "../access"
import type { PartsNoteFilterSet, PartsNoteTab } from "../parts/types"
import { noteVisibility, noteVisibilitySql } from "./access"

/**
 * Condiciones SQL de la bandeja de notas de pedido y de su exportación: una sola fuente para las dos (la planilla trae lo
 * mismo que se ve). Todas asumen que la consulta une `mant_work_orders` y `fuel_vehicles` (`leftJoin`) a `mant_parts_notes`.
 * El alcance (`noteVisibilitySql`) va SIEMPRE primero y no sale de ningún filtro: la URL sólo recorta.
 */

/** La NP tiene al menos una línea pendiente: lo que jefatura todavía tiene que resolver. */
export const noteHasPendingLineSql = sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.resolution} = 'pendiente')`
/** NP abierta: ni cerrada, ni rechazada, ni anulada (ADR 0001, 2026-11-27). */
const noteOpenSql = sql`${mantPartsNotes.status} not in ('cerrada', 'rechazada', 'anulada')`

/**
 * Qué agrupa cada pestaña de la bandeja (NP4-2, decisión 2026-11-26). «Pendientes» (las notas por resolver, y la cifra del
 * Panel) es toda nota abierta con al menos una línea pendiente, aunque tenga otras ya resueltas. «En gestión» es lo que
 * no tiene nada pendiente pero espera una compra que aún no llega. «Cerradas», lo cerrado, lo rechazado y lo anulado.
 */
export const TAB_CONDITIONS: Record<PartsNoteTab, SQL> = {
  pendientes: sql`(${noteOpenSql} and ${noteHasPendingLineSql})`,
  en_gestion: sql`(${noteOpenSql} and not ${noteHasPendingLineSql})`,
  cerradas: sql`${mantPartsNotes.status} in ('cerrada', 'rechazada', 'anulada')`,
}

const CHILE_DAY = sql`(${mantPartsNotes.createdAt} AT TIME ZONE 'America/Santiago')::date`

/** `exists` sobre las líneas de la NP con una condición propia. */
const lineExists = (condition: SQL) =>
  sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${condition})`

const likePattern = (text: string) => `%${escapeLikePattern(text)}%`

/**
 * Filtros comunes a la bandeja, los conteos y la exportación (todo menos la pestaña y el estado exacto, que cada
 * consulta suma según lo que cuenta). Un texto vacío no filtra.
 */
export function noteFilterConditions(viewer: MantViewer, filters: PartsNoteFilterSet): SQL[] {
  const conditions: SQL[] = [noteVisibilitySql(noteVisibility(viewer))]
  if (filters.worksiteId) conditions.push(eq(mantPartsNotes.worksiteId, filters.worksiteId))
  if (filters.urgent !== undefined) conditions.push(eq(mantPartsNotes.urgent, filters.urgent))
  if (filters.from) conditions.push(sql`${CHILE_DAY} >= ${filters.from}::date`)
  if (filters.to) conditions.push(sql`${CHILE_DAY} <= ${filters.to}::date`)

  const requester = filters.requester?.trim()
  if (requester) {
    const pattern = likePattern(requester)
    conditions.push(or(
      ilike(mantPartsNotes.requestedByName, pattern),
      sql`exists (select 1 from ${users} where ${users.id} = ${mantPartsNotes.requestedByUserId} and ${users.name} ilike ${pattern})`,
    )!)
  }

  const equipment = filters.equipment?.trim()
  if (equipment) {
    const pattern = likePattern(equipment)
    conditions.push(or(
      ilike(fuelVehicles.code, pattern),
      ilike(fuelVehicles.plate, pattern),
      // Cargo de una línea: el equipo al que se imputa, o el texto original que no calzó con ninguno.
      lineExists(sql`(${mantPartsNoteItems.chargeText} ilike ${pattern}
        or exists (select 1 from ${fuelVehicles} charge_vehicle
          where charge_vehicle.id = ${mantPartsNoteItems.chargeVehicleId} and (charge_vehicle.code ilike ${pattern} or charge_vehicle.plate ilike ${pattern})))`),
    )!)
  }

  const article = filters.article?.trim()
  if (article) {
    const pattern = likePattern(article)
    conditions.push(lineExists(sql`(${mantPartsNoteItems.description} ilike ${pattern}
      or ${mantPartsNoteItems.partNumber} ilike ${pattern}
      or exists (select 1 from ${products} part where part.id = ${mantPartsNoteItems.productId} and (part.name ilike ${pattern} or part.sku ilike ${pattern})))`))
  }

  const text = filters.q?.trim()
  if (text) {
    const pattern = likePattern(text)
    conditions.push(or(
      ilike(mantPartsNotes.code, pattern),
      ilike(mantPartsNotes.externalRef, pattern),
      ilike(mantPartsNotes.requestedByName, pattern),
      ilike(mantWorkOrders.folio, pattern),
      ilike(fuelVehicles.code, pattern),
      ilike(fuelVehicles.plate, pattern),
      sql`exists (select 1 from ${users} where ${users.id} = ${mantPartsNotes.requestedByUserId} and ${users.name} ilike ${pattern})`,
      lineExists(sql`${mantPartsNoteItems.description} ilike ${pattern}`),
    )!)
  }
  return conditions
}

/** Estado exacto: se suma a la pestaña, no la reemplaza. */
export const statusCondition = (status: string): SQL => eq(mantPartsNotes.status, status)
