"use server"

import { safeActionMessage } from "@/lib/action-error"

import { guardPermission } from "@/lib/auth/can"
import { civilDate, civilDateRange } from "@/lib/validation/dates"
import { getCopecSweepPeriods, getCopecSyncPlan, getCopecSyncState, listCopecSyncRunsSince, setCopecSyncStartDate, syncCopecReports } from "@/lib/combustibles/copec-sync"
import { copecSyncAvailability } from "@/lib/combustibles/copec-reports"
import { listCopecPeriodCoverage, recordCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { canConfirmCopecEmpty } from "@/lib/combustibles/copec-coverage"
import { getCronRunSince, isCronJobRunning, startCronJobInBackground } from "@/lib/services/cron-lock"
import { userFacingErrorText } from "@/lib/user-facing-error"
import { isOpenPeriod } from "@/lib/combustibles/open-period"
import { z } from "zod"

const copecPeriodSchema = civilDateRange({ required: true, message: "El período de Copec no es válido" })
const copecStartDateSchema = z.object({
  startDate: civilDate(),
  expectedStart: civilDate(),
})
const copecEmptyCoverageSchema = z.object({
  month: civilDate(),
  channel: z.enum(["TCT", "TAE"]),
  product: z.enum(["diesel", "bluemax"]),
  evidence: z.string().trim().min(20, "Describe la evidencia consultada en Copec").max(500),
})

export type CopecSyncStatus = Awaited<ReturnType<typeof getCopecSyncState>>

export interface CopecSyncStartOptions {
  currentStart: string
  minimumStart: string
  maximumStart: string
  latestImportedUntil: string | null
}

export async function getCopecSyncStatusAction(): Promise<
  | { ok: true; data: CopecSyncStatus }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  try {
    return { ok: true, data: await getCopecSyncState() }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible obtener el estado del sync") }
  }
}

export interface CopecSweepRunView {
  from: string
  status: string
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  /** Ya filtrado para el operador: nunca una consulta SQL ni una ruta del servidor. */
  error: string | null
}

const COPEC_SYNC_JOB = "fuel-copec-sync"

/**
 * Inicia la MISMA corrida del cron —el mes en curso y los meses pendientes, en
 * una sola sesión del portal— y responde apenas toma el lock, sin esperar a que
 * termine: detrás de Cloudflare una petición de más de ~100 s se corta y la
 * pantalla daba por perdida una corrida que sí terminaba. El avance se lee con
 * `getCopecSyncProgressAction`.
 *
 * Antes el botón pedía un mes por petición, siempre el pendiente más antiguo:
 * si ese mes quedaba incompleto el siguiente se rechazaba («ya no corresponde
 * al siguiente tramo») y el mes en curso nunca se pedía. Y cada mes era un login
 * —un correo con código— distinto.
 */
export async function startCopecSyncAction(): Promise<
  | { ok: true; since: string; periods: Array<{ from: string; to: string }> }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  if (!copecSyncAvailability().hasCredentials) {
    return { ok: false, message: "Faltan las credenciales de Copec en el servidor (COPEC_USERNAME y COPEC_PASSWORD)." }
  }
  try {
    const periods = await getCopecSweepPeriods()
    // Un margen hacia atrás: el reloj de la base marca `started_at`, no el de la app.
    const since = new Date(Date.now() - 2_000).toISOString()
    const importerId = guard.session.user.id
    const outcome = await startCronJobInBackground(COPEC_SYNC_JOB, () => syncCopecReports({ importerId }))
    if (outcome === "busy") {
      return { ok: false, message: "Ya hay una sincronización de Copec en curso (la automática o la de otra persona). Espera a que termine e inténtalo nuevamente." }
    }
    return { ok: true, since, periods }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible iniciar la sincronización Copec") }
  }
}

export async function getCopecSyncProgressAction(input: { since: string }): Promise<
  | { ok: true; running: boolean; outcome: string | null; detail: string | null; runs: CopecSweepRunView[] }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  const parsed = z.object({ since: z.iso.datetime() }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "La consulta de avance no es válida" }
  try {
    const [running, cronRun, runs] = await Promise.all([
      isCronJobRunning(COPEC_SYNC_JOB),
      getCronRunSince(COPEC_SYNC_JOB, parsed.data.since),
      listCopecSyncRunsSince(parsed.data.since),
    ])
    return {
      ok: true,
      running,
      outcome: cronRun?.outcome ?? null,
      detail: cronRun?.detail ? userFacingErrorText(cronRun.detail) ?? "La corrida se detuvo por un error interno; revisa la bitácora de cron." : null,
      runs: runs.map((run) => ({
        from: run.requestedFrom,
        status: run.status,
        rowsReceived: run.rowsReceived,
        rowsAccepted: run.rowsAccepted,
        rowsRejected: run.rowsRejected,
        rowsPending: run.rowsPending,
        error: run.error ? userFacingErrorText(run.error) ?? "Error interno en este mes; revisa la bitácora de sincronización." : null,
      })),
    }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible obtener el avance de la sincronización Copec") }
  }
}

/** Read-only coverage/provenance contract for dashboards and data exports. */
export async function getCopecCoverageRangeAction(range: { from: string; to: string }): Promise<
  | { ok: true; data: Awaited<ReturnType<typeof listCopecPeriodCoverage>> }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:view_costs", "/combustibles")
  if (guard.error) return guard.error
  try {
    const parsed = copecPeriodSchema.safeParse(range)
    if (!parsed.success || !parsed.data.from || !parsed.data.to) return { ok: false, message: "El rango de cobertura no es válido" }
    return { ok: true, data: await listCopecPeriodCoverage(parsed.data.from, parsed.data.to) }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible obtener la cobertura Copec") }
  }
}

export async function confirmCopecPeriodEmptyAction(input: {
  month: string
  channel: "TCT" | "TAE"
  product: "diesel" | "bluemax"
  evidence: string
}): Promise<
  | { ok: true; data: CopecSyncStatus }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  try {
    const parsed = copecEmptyCoverageSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "La confirmación de período vacío no es válida" }
    const { month, channel, product, evidence } = parsed.data
    if (!month.endsWith("-01")) return { ok: false, message: "El mes debe comenzar el día 1" }
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
    if (isOpenPeriod(end)) return { ok: false, message: "No se puede cerrar como vacío un mes que todavía está abierto" }
    const plan = await getCopecSyncPlan()
    if (plan.from !== month) return { ok: false, message: "Solo puedes confirmar el mes pendiente más antiguo; actualiza la página e inténtalo de nuevo" }
    const existing = await listCopecPeriodCoverage(month, end)
    const currentCoverage = existing.find((row) => row.channel === channel && row.product === product)
    if (!canConfirmCopecEmpty(currentCoverage)) {
      return { ok: false, message: "Solo se puede confirmar vacío cuando no existe un archivo procesable ni datos rechazados o pendientes" }
    }
    await recordCopecPeriodCoverage({
      channel,
      product,
      month,
      status: "legitimate_empty",
      sourceAvailability: "available",
      // Si Copec entregó un archivo vacío, la confirmación queda ligada a él.
      sourceFileId: currentCoverage?.sourceFileId ?? null,
      evidence,
      evidenceActorUserId: guard.session.user.id,
    })
    return { ok: true, data: await getCopecSyncState() }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible confirmar el período vacío") }
  }
}

export async function updateCopecSyncStartAction(input: { startDate: string; expectedStart: string }): Promise<
  | { ok: true; data: CopecSyncStartOptions }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  try {
    const parsed = copecStartDateSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: "La fecha de inicio no es válida" }
    return { ok: true, data: await setCopecSyncStartDate(parsed.data.startDate, parsed.data.expectedStart) }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible actualizar la fecha de inicio") }
  }
}
