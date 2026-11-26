import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, mantPartsNotes, mantRecords, mantWorkOrders } from "@/db/schema"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

/**
 * Refresca «Mis pendientes» y los avisos del menú cuando una acción de Mantención cambia un estado que la cola mira
 * (una OT cambia de etapa, una nota se resuelve, un registro se revisa, se observa o se anula).
 *
 * Sin esto el número del menú queda viejo hasta 30 s (la caché del layout, P-01): se asigna la OT y el aviso del jefe
 * no baja. Se invalida con la faena (PER-T01) para no vaciar los avisos de toda la plataforma: la etiqueta global
 * —que llevan las sesiones de visión global, como el jefe— cae igual con cualquier faena.
 *
 * Las OT y las notas siguen al equipo, así que cuentan DOS faenas: la de imputación y aquella donde hoy está el
 * equipo (un traslado las separa).
 *
 * Nunca lanza: la acción ya escribió en la base y un fallo al resolver la faena no puede convertir un éxito en un
 * error. Si no se encuentra la faena, se invalida sin acotar, que es lo seguro.
 *
 * Los cambios que entran por el teléfono (`app/api/mantencion/*`) esperan el TTL de 30 s.
 */

type Paths = Iterable<string>

function invalidate(worksiteIds: readonly string[], paths: Paths) {
  const ids = [...new Set(worksiteIds.filter(Boolean))]
  if (ids.length === 0) {
    revalidateOperationalViews(paths)
    return
  }
  // Las rutas se revalidan una sola vez; el resto de las vueltas sólo cambia la etiqueta de la faena.
  ids.forEach((worksiteId, index) => revalidateOperationalViews(index === 0 ? paths : [], { worksiteId }))
}

async function refresh(paths: Paths, resolveWorksites: () => Promise<string[]>) {
  let worksiteIds: string[] = []
  try {
    worksiteIds = await resolveWorksites()
  } catch (error) {
    logger.warn("No se pudo resolver la faena para refrescar los avisos de Mantención", {
      event: "mantencion_queue_revalidation_worksite_failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
  try {
    invalidate(worksiteIds, paths)
  } catch (error) {
    logger.warn("No se pudieron refrescar los avisos de Mantención", {
      event: "mantencion_queue_revalidation_failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Una OT cambió: la faena de imputación y la actual de su equipo. */
export async function revalidateQueueOfWorkOrder(workOrderId: string, paths: Paths = []): Promise<void> {
  await refresh(paths, async () => {
    const [row] = await db
      .select({ imputed: mantWorkOrders.worksiteId, current: fuelVehicles.worksiteId })
      .from(mantWorkOrders)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
      .where(eq(mantWorkOrders.id, workOrderId))
      .limit(1)
    return row ? [row.imputed, row.current] : []
  })
}

/** Una nota cambió: la faena de la nota (la de su OT) y la actual de su equipo. */
export async function revalidateQueueOfNote(noteId: string, paths: Paths = []): Promise<void> {
  await refresh(paths, async () => {
    const [row] = await db
      .select({ imputed: mantPartsNotes.worksiteId, current: fuelVehicles.worksiteId })
      .from(mantPartsNotes)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
      .where(eq(mantPartsNotes.id, noteId))
      .limit(1)
    return row ? [row.imputed, row.current] : []
  })
}

/** Uno o varios registros cambiaron: la faena de cada uno (la que reparte la revisión). */
export async function revalidateQueueOfRecords(recordIds: readonly string[], paths: Paths = []): Promise<void> {
  await refresh(paths, async () => {
    if (recordIds.length === 0) return []
    const rows = await db
      .select({ worksiteId: mantRecords.worksiteId })
      .from(mantRecords)
      .where(inArray(mantRecords.id, [...recordIds]))
    return rows.map((row) => row.worksiteId)
  })
}
