"use server"

import { and, asc, gt, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelEquipmentLoads, fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSqlFor } from "@/lib/auth/scope"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import {
  diffMarkSnapshots,
  performanceThresholdsSchema,
  RECOMPUTE_BATCH_SIZE,
  recomputeInputSchema,
  type MarkSnapshot,
  type PerformanceThresholdsInput,
} from "@/lib/combustibles/control/catalogs"
import { getPerformanceControlSettings, savePerformanceControlSettings } from "@/lib/combustibles/control/settings"
import { recomputeVehicles } from "@/lib/combustibles/control/projection-series"
import type { ConfigResult } from "./actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"

const PERMISSION = "combustibles:manage_control" as const
const RECOMPUTE_LOCK = "fuel_control_recompute_series"

/** Parte editable de los umbrales, tal como queda guardada. */
const EDITABLE_KEYS = ["minSamples", "maxKmPerLiter", "maxLitersPerHour", "duplicateWindowMinutes", "duplicateLitersTolerance"] as const

/**
 * Guarda los umbrales editables. `thresholdStdDevs` no se toma del formulario:
 * viene de la regla `rendimiento_fuera_historico` y se conserva tal cual.
 * No recalcula nada en la petición (una serie larga no cabe en una solicitud
 * corta): responde `data.changed` y la pantalla encadena `recomputeSeriesBatchAction`
 * por lotes, con avance y el conteo de cargas que cambiaron.
 * `savePerformanceControlSettings` audita por sí misma.
 */
export async function savePerformanceThresholdsAction(input: PerformanceThresholdsInput): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(performanceThresholdsSchema, input)
  if (!parsed.ok) return parsed
  try {
    const current = await getPerformanceControlSettings()
    const changed = EDITABLE_KEYS.some((key) => current[key] !== parsed.data[key])
    await db.transaction(async (tx) => {
      await savePerformanceControlSettings(tx, { ...current, ...parsed.data }, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    })
    revalidateFuel()
    return {
      ok: true,
      message: changed ? "Umbrales guardados." : "Los umbrales ya estaban así: no hay nada que recalcular.",
      data: { changed },
    }
  } catch (error) {
    return actionErrorResult(error, "No se pudieron guardar los umbrales")
  }
}

export interface RecomputeProgress {
  /** Equipos procesados en esta solicitud. */
  processed: number
  /** Equipos con cargas dentro del alcance del usuario. */
  total: number
  /** Último equipo procesado: se reenvía para continuar. `null` si no quedó ninguno. */
  nextCursor: string | null
  done: boolean
  /** Cargas de este lote cuya marca de revisión o estado de rendimiento cambió. */
  changedLoads: number
  /** De ellas, las que pasaron a «Por decidir». */
  flagged: number
  /** De ellas, las que dejaron de estar «Por decidir». */
  released: number
}

/**
 * Foto de las marcas de las cargas de un lote de equipos: estado de revisión
 * y una firma de lo que el recálculo puede mover (motivos, duplicada de,
 * estado de rendimiento). Antes y después del recálculo, la diferencia dice
 * cuántas cargas cambiaron sin que `recomputeVehicleSeries` tenga que contarlas.
 */
async function snapshotMarks(tx: Tx, vehicleIds: string[]): Promise<MarkSnapshot> {
  if (vehicleIds.length === 0) return new Map()
  const rows = await tx.select({
    id: fuelEquipmentLoads.id,
    reviewStatus: fuelEquipmentLoads.reviewStatus,
    signature: sql<string>`md5(concat_ws('|', ${fuelEquipmentLoads.reviewStatus}, ${fuelEquipmentLoads.flagReasons}::text, coalesce(${fuelEquipmentLoads.duplicateOfId}, ''), ${fuelEquipmentLoads.performanceStatus}))`,
  }).from(fuelEquipmentLoads).where(inArray(fuelEquipmentLoads.vehicleId, vehicleIds))
  return new Map(rows.map((row) => [row.id, { reviewStatus: row.reviewStatus, signature: row.signature }]))
}

/**
 * Recalcula la serie de rendimiento de un lote de equipos (hasta
 * `RECOMPUTE_BATCH_SIZE`), en orden de id y partiendo después de `cursor`. El
 * cliente repite la llamada con `nextCursor` hasta `done`, de modo que ninguna
 * petición sea larga. Solo toca equipos con cargas y de faenas del alcance del
 * usuario. Un candado de transacción impide dos lotes simultáneos.
 */
export async function recomputeSeriesBatchAction(input: { cursor: string | null }): Promise<ConfigResult & { data?: RecomputeProgress }> {
  const guard = await guardPermission(PERMISSION, FUEL_PATHS.ajustes)
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(recomputeInputSchema, input)
  if (!parsed.ok) return parsed
  const { cursor } = parsed.data

  const scopeSql = worksiteScopeSqlFor(serviceWorksiteScope(session), fuelVehicles.worksiteId)
  const hasLoads = sql`exists (select 1 from fuel_equipment_loads l where l.vehicle_id = ${fuelVehicles.id})`

  try {
    const result = await db.transaction(async (tx): Promise<ConfigResult & { data?: RecomputeProgress }> => {
      // `execute` devuelve un arreglo (postgres-js) o `{ rows }` (PGlite): se aceptan ambas formas.
      const lockResult = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${RECOMPUTE_LOCK})) as locked`) as unknown
      const lockRows = (Array.isArray(lockResult) ? lockResult : (lockResult as { rows?: unknown[] }).rows ?? []) as Array<{ locked?: boolean }>
      if (lockRows[0]?.locked === false) return { ok: false, message: "Ya hay un recálculo en curso. Espera a que termine e inténtalo de nuevo." }

      const [totalRow] = await tx.select({ total: sql<number>`count(*)::int` }).from(fuelVehicles).where(and(scopeSql, hasLoads))
      const total = totalRow?.total ?? 0
      const batch = await tx.select({ id: fuelVehicles.id }).from(fuelVehicles)
        .where(and(scopeSql, hasLoads, cursor ? gt(fuelVehicles.id, cursor) : undefined))
        .orderBy(asc(fuelVehicles.id))
        .limit(RECOMPUTE_BATCH_SIZE)

      const batchIds = batch.map((vehicle) => vehicle.id)
      const before = await snapshotMarks(tx, batchIds)
      await recomputeVehicles(tx, batchIds)
      const changes = diffMarkSnapshots(before, await snapshotMarks(tx, batchIds))

      const nextCursor = batch.length ? batch[batch.length - 1]!.id : null
      const done = batch.length < RECOMPUTE_BATCH_SIZE
      if (batch.length) {
        await recordAudit({
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          action: "update",
          entityType: "fuel_control_series_recompute",
          entityId: nextCursor!,
          reason: "Recálculo manual de series de rendimiento",
          newState: { vehicles: batch.length, firstVehicleId: batch[0]!.id, lastVehicleId: nextCursor, ...changes },
        }, tx)
      }
      return { ok: true, message: done ? "Recálculo terminado" : undefined, data: { processed: batch.length, total, nextCursor, done, ...changes } }
    })
    if (result.ok && result.data?.done) {
      revalidateFuel()
    }
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo recalcular las series")
  }
}
