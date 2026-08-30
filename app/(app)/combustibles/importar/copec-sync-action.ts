"use server"

import { safeActionMessage } from "@/lib/action-error"

import { db } from "@/db"
import { desc, eq } from "drizzle-orm"
import { fuelProviderSyncRuns, systemSettings } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { civilDate, civilDateRange } from "@/lib/validation/dates"
import { getCopecSyncPlan, setCopecSyncStartDate, syncCopecReportPeriod } from "@/lib/combustibles/copec-sync"
import { withCronLock } from "@/lib/services/cron-lock"
import { isOpenPeriod } from "@/lib/combustibles/open-period"
import { z } from "zod"

const STATE_KEY = "combustibles.copec.sync"
const copecPeriodSchema = civilDateRange({ required: true, message: "El período de Copec no es válido" })
const copecStartDateSchema = z.object({
  startDate: civilDate(),
  expectedStart: civilDate(),
})

export interface CopecSyncStatus {
  lastRunAt: string | null
  lastRunStatus: string | null
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  affectedQuantity: number
  affectedAmount: number
  cursor: string | null
  pending: number
}

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
    const [row, latestRun] = await Promise.all([
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) }),
      db.query.fuelProviderSyncRuns.findFirst({ where: eq(fuelProviderSyncRuns.provider, "copec"), orderBy: [desc(fuelProviderSyncRuns.startedAt)] }),
    ])
    if (!row) {
      return { ok: true, data: { lastRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? null, lastRunStatus: latestRun?.status ?? null, rowsReceived: latestRun?.rowsReceived ?? 0, rowsAccepted: latestRun?.rowsAccepted ?? 0, rowsRejected: latestRun?.rowsRejected ?? 0, rowsPending: latestRun?.rowsPending ?? 0, affectedQuantity: latestRun?.affectedQuantity ?? 0, affectedAmount: latestRun?.affectedAmount ?? 0, cursor: null, pending: latestRun?.rowsPending ?? 0 } }
    }
    let state: { cursor?: string | null; lastRunAt?: string | null; pending?: string[] } = {}
    try { state = JSON.parse(row.value) } catch { /* fall through */ }
    return {
      ok: true,
      data: {
        lastRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? state.lastRunAt ?? null,
        lastRunStatus: latestRun?.status ?? null,
        rowsReceived: latestRun?.rowsReceived ?? 0,
        rowsAccepted: latestRun?.rowsAccepted ?? 0,
        rowsRejected: latestRun?.rowsRejected ?? 0,
        rowsPending: latestRun?.rowsPending ?? 0,
        affectedQuantity: latestRun?.affectedQuantity ?? 0,
        affectedAmount: latestRun?.affectedAmount ?? 0,
        cursor: state.cursor ?? null,
        pending: latestRun?.rowsPending ?? (Array.isArray(state.pending) ? state.pending.length : 0),
      },
    }
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
