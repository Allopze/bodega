import { eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, purchaseRequestItems, purchaseRequests, users } from "@/db/schema"
import { itemHasNoActiveOrderSql } from "@/lib/adquisiciones/pending-purchase"
import { NOTE_AGE_BUCKETS } from "@/lib/mantencion/parts-notes-age"
import { escapeLikePattern, todayInChile } from "@/lib/utils"
import type { MantViewer } from "../access"
import type { PartsNoteAgeKey, PartsNoteFilterSet, PartsNoteTab } from "../parts/types"
import { noteVisibility, noteVisibilitySql } from "./access"
import { statusSinceSql } from "./history"

/**
 * Condiciones SQL de la bandeja de notas de pedido y de su exportación: una sola fuente para las dos (la planilla trae lo
 * mismo que se ve). Todas asumen que la consulta une `mant_work_orders` y `fuel_vehicles` (`leftJoin`) a `mant_parts_notes`.
 * El alcance (`noteVisibilitySql`) va SIEMPRE primero y no sale de ningún filtro: la URL sólo recorta.
 */

/** La NP tiene al menos una línea pendiente: lo que jefatura todavía tiene que resolver. */
export const noteHasPendingLineSql = sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.resolution} = 'pendiente')`

/**
 * Una compra de una línea de la NP sigue VIVA salvo que su ítem esté rechazado o su solicitud cancelada o rechazada: el
 * mismo criterio de `isDeadPurchase` (`status.ts`), escrito en SQL. Una prueba PGlite cuida que no se separen.
 */
const liveRequestItemSql = sql`not (${purchaseRequestItems.status} = 'rejected' or ${purchaseRequests.status} in ('cancelled', 'rejected'))`

/**
 * Una línea «en compra» de la NP tiene una compra viva SIN orden de compra activa: lo que quien compra todavía tiene que
 * ordenar. «OC activa» es la de `itemHasNoActiveOrderSql` (la misma de la cola «Pendientes de orden de compra» de Compras):
 * una sola definición. Correlacionada con `mant_parts_notes`.
 */
export const noteHasUnorderedPurchaseSql = sql`exists (
  select 1 from ${purchaseRequestItems}
  inner join ${purchaseRequests} on ${purchaseRequests.id} = ${purchaseRequestItems.requestId}
  inner join ${mantPartsNoteItems} on ${mantPartsNoteItems.id} = ${purchaseRequestItems.partsNoteItemId}
  where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id}
    and ${mantPartsNoteItems.resolution} = 'en_compra'
    and ${liveRequestItemSql}
    and ${itemHasNoActiveOrderSql}
)`

/**
 * Qué agrupa cada pestaña de la bandeja (fase 2, 2026-11-27): el recorrido de la compra, cada nota en UNA sola.
 *  - «Por revisar»: queda alguna línea por resolver (los estados de antes de comprar).
 *  - «En compra»: ninguna línea pendiente y alguna compra viva aún sin orden de compra activa.
 *  - «En recepción»: recibida parcial, o todas sus compras vivas ya tienen OC activa y falta que lleguen.
 *  - «Cerradas»: cerrada, rechazada o anulada.
 * Las dos del medio parten el estado `en_compra` según el ítem de solicitud de sus líneas: ahí es donde la nota cambia de manos.
 */
export const TAB_CONDITIONS: Record<PartsNoteTab, SQL> = {
  por_revisar: sql`${mantPartsNotes.status} in ('enviada', 'aceptada', 'en_espera', 'en_gestion')`,
  en_compra: sql`(${mantPartsNotes.status} = 'en_compra' and ${noteHasUnorderedPurchaseSql})`,
  en_recepcion: sql`(${mantPartsNotes.status} = 'recibida_parcial' or (${mantPartsNotes.status} = 'en_compra' and not ${noteHasUnorderedPurchaseSql}))`,
  cerradas: sql`${mantPartsNotes.status} in ('cerrada', 'rechazada', 'anulada')`,
}

/**
 * Días civiles de Chile entre hoy y el momento en que la nota llegó a su estado actual (`status_since`). `today` es el
 * día de hoy en Chile (`todayInChile()`), no el de UTC: entre las 20:00 y la medianoche chilena UTC ya cambió de día.
 */
export function noteAgeDaysSql(today: string): SQL<number> {
  return sql<number>`greatest(0, ${today}::date - (${statusSinceSql} at time zone 'America/Santiago')::date)`
}

/** Condición de un tramo de `?antiguedad=`. */
export function noteAgeFilterSql(key: PartsNoteAgeKey, today: string): SQL {
  const bucket = NOTE_AGE_BUCKETS.find((candidate) => candidate.key === key)!
  const age = noteAgeDaysSql(today)
  return bucket.max === null ? sql`${age} >= ${bucket.min}` : sql`${age} between ${bucket.min} and ${bucket.max}`
}

const CHILE_DAY = sql`(${mantPartsNotes.createdAt} AT TIME ZONE 'America/Santiago')::date`

/** `exists` sobre las líneas de la NP con una condición propia. */
const lineExists = (condition: SQL) =>
  sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${condition})`

const likePattern = (text: string) => `%${escapeLikePattern(text)}%`

/**
 * Filtros comunes a la bandeja, los conteos y la exportación (todo menos la pestaña y el estado exacto, que cada
 * consulta suma según lo que cuenta). Un texto vacío no filtra. `today` (por omisión, hoy en Chile) fija el día contra el
 * que se miden los días del filtro de antigüedad.
 */
export function noteFilterConditions(viewer: MantViewer, filters: PartsNoteFilterSet, options: { today?: string } = {}): SQL[] {
  const conditions: SQL[] = [noteVisibilitySql(noteVisibility(viewer))]
  if (filters.worksiteId) conditions.push(eq(mantPartsNotes.worksiteId, filters.worksiteId))
  if (filters.urgent !== undefined) conditions.push(eq(mantPartsNotes.urgent, filters.urgent))
  if (filters.age) conditions.push(noteAgeFilterSql(filters.age, options.today ?? todayInChile()))
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
