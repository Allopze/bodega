"use server"

import { safeActionMessage } from "@/lib/action-error"

import { guardPermission } from "@/lib/auth/can"
import { civilDate, civilDateRange } from "@/lib/validation/dates"
import { getCopecSyncPlan, getCopecSyncState, setCopecSyncStartDate, syncCopecReportPeriod } from "@/lib/combustibles/copec-sync"
import { listCopecPeriodCoverage, recordCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { canConfirmCopecEmpty } from "@/lib/combustibles/copec-coverage"
import { withCronLock } from "@/lib/services/cron-lock"
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

export async function getCopecSyncPlanAction(): Promise<
  | { ok: true; from: string; to: string; periods: Array<{ from: string; to: string }> }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  try {
    const result = await getCopecSyncPlan()
    return { ok: true, from: result.from, to: result.to, periods: result.periods }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible preparar la sincronización Copec") }
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

export async function runCopecSyncPeriodAction(period: { from: string; to: string }): Promise<
  | { ok: true; imported: number; refreshed: number; received: number; pending: number; rowsReceived: number; rowsAccepted: number; rowsRejected: number; rowsPending: number; unavailable: string[]; reports: number; unmappedCards: string[]; openPeriod: boolean }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:sync_integrations", "/combustibles/importar")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsedPeriod = copecPeriodSchema.safeParse(period)
    if (!parsedPeriod.success || !parsedPeriod.data.from || !parsedPeriod.data.to) {
      return { ok: false, message: "El período de Copec no es válido" }
    }
    const periodRange = { from: parsedPeriod.data.from, to: parsedPeriod.data.to }

    const plan = await getCopecSyncPlan()
    const expected = plan.periods[0]
    if (!expected || expected.from !== periodRange.from || expected.to !== periodRange.to) {
      return { ok: false, message: "El período ya no corresponde al siguiente tramo pendiente. Actualiza e inténtalo nuevamente." }
    }

    // La acción manual usa al operador autenticado. El importador configurado
    // queda reservado para el cron, que no tiene sesión de usuario.
    //
    // Bajo el MISMO lock que el cron: Copec abre una sesión de navegador con
    // login por descarga y el portal es de sesión única, así que un botón
    // manual durante la corrida automática pelea por la sesión del portal y
    // por el cursor (el `saveState` optimista descarta el avance del perdedor).
    const outcome = await withCronLock("fuel-copec-sync", () => syncCopecReportPeriod(periodRange, session.user.id))
    if ("skipped" in outcome) {
      return { ok: false, message: "La sincronización automática de Copec está corriendo en este momento. Espera a que termine e inténtalo nuevamente." }
    }
    const result = outcome
    // `openPeriod` lo decide el servidor: el cliente no puede compararlo contra
    // "hoy" sin arriesgar el desfase de zona horaria que ya costó un bug acá.
    return { ok: true, imported: result.imported, refreshed: result.refreshed, received: result.received, pending: result.pending, rowsReceived: result.rowsReceived, rowsAccepted: result.rowsAccepted, rowsRejected: result.rowsRejected, rowsPending: result.rowsPending, unavailable: result.unavailable, reports: result.reports.length, unmappedCards: result.unmappedCards, openPeriod: isOpenPeriod(periodRange.to) }
  } catch (error) {
    // Los errores de Playwright arrastran el "Call log:" completo -kilobytes de
    // reintentos- y el toast del operador, que persiste hasta cerrarlo a mano,
    // los mostraba enteros. El motivo siempre va en la primera linea.
    const message = error instanceof Error ? (error.message.split(/\r?\nCall log:/)[0] ?? "").trim() : ""
    return { ok: false, message: message || "No fue posible sincronizar Copec" }
  }
}
