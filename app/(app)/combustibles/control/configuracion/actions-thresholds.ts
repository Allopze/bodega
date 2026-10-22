"use server"

import { revalidatePath } from "next/cache"
import { and, asc, gt, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSqlFor } from "@/lib/auth/scope"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import {
  performanceThresholdsSchema,
  RECOMPUTE_BATCH_SIZE,
  recomputeInputSchema,
  type PerformanceThresholdsInput,
} from "@/lib/combustibles/control/catalogs"
import { getPerformanceControlSettings, savePerformanceControlSettings } from "@/lib/combustibles/control/settings"
import { recomputeVehicles } from "@/lib/combustibles/control/projection-series"
import type { ConfigResult } from "./actions"

const PERMISSION = "combustibles:manage_control" as const
const RECOMPUTE_LOCK = "fuel_control_recompute_series"

/**
 * Guarda los umbrales editables. `thresholdStdDevs` no se toma del formulario:
 * viene de la regla `rendimiento_fuera_historico` y se conserva tal cual.
 * No recalcula nada en la petición: los valores rigen para cargas nuevas y para
 * las que se recalculen con `recomputeSeriesBatchAction`.
 * `savePerformanceControlSettings` audita por sí misma.
 */
export async function savePerformanceThresholdsAction(input: PerformanceThresholdsInput): Promise<ConfigResult> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(performanceThresholdsSchema, input)
  if (!parsed.ok) return parsed
  try {
    const current = await getPerformanceControlSettings()
    await db.transaction(async (tx) => {
      await savePerformanceControlSettings(tx, { ...current, ...parsed.data }, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    })
    revalidatePath("/combustibles/control/configuracion")
    return { ok: true, message: "Umbrales guardados. Rigen para las cargas nuevas y las que se recalculen." }
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
}

/**
 * Recalcula la serie de rendimiento de un lote de equipos (hasta
 * `RECOMPUTE_BATCH_SIZE`), en orden de id y partiendo después de `cursor`. El
 * cliente repite la llamada con `nextCursor` hasta `done`, de modo que ninguna
 * petición sea larga. Solo toca equipos con cargas y de faenas del alcance del
 * usuario. Un candado de transacción impide dos lotes simultáneos.
 */
export async function recomputeSeriesBatchAction(input: { cursor: string | null }): Promise<ConfigResult & { data?: RecomputeProgress }> {
  const guard = await guardPermission(PERMISSION, "/combustibles/control/configuracion")
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

      await recomputeVehicles(tx, batch.map((vehicle) => vehicle.id))

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
          newState: { vehicles: batch.length, firstVehicleId: batch[0]!.id, lastVehicleId: nextCursor },
        }, tx)
      }
      return { ok: true, message: done ? "Recálculo terminado" : undefined, data: { processed: batch.length, total, nextCursor, done } }
    })
    if (result.ok && result.data?.done) {
      revalidatePath("/combustibles/control", "layout")
    }
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo recalcular las series")
  }
}
