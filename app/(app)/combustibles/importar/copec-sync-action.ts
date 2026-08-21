"use server"

import { db } from "@/db"
import { eq } from "drizzle-orm"
import { systemSettings } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { getCopecSyncPlan, setCopecSyncStartDate, syncCopecReportPeriod } from "@/lib/combustibles/copec-sync"
import { z } from "zod"

const STATE_KEY = "combustibles.copec.sync"
const copecPeriodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
const copecStartDateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export interface CopecSyncStatus {
  lastRunAt: string | null
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
  const guard = await guardPermission("combustibles:import")
  if (guard.error) return guard.error
  try {
    const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) })
    if (!row) {
      return { ok: true, data: { lastRunAt: null, cursor: null, pending: 0 } }
    }
    let state: { cursor?: string | null; lastRunAt?: string | null; pending?: string[] } = {}
    try { state = JSON.parse(row.value) } catch { /* fall through */ }
    return {
      ok: true,
      data: {
        lastRunAt: state.lastRunAt ?? null,
        cursor: state.cursor ?? null,
        pending: Array.isArray(state.pending) ? state.pending.length : 0,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible obtener el estado del sync" }
  }
}

export async function getCopecSyncPlanAction(): Promise<
  | { ok: true; from: string; to: string; periods: Array<{ from: string; to: string }> }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:import")
  if (guard.error) return guard.error
  try {
    const result = await getCopecSyncPlan()
    return { ok: true, from: result.from, to: result.to, periods: result.periods }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible preparar la sincronización Copec" }
  }
}

export async function updateCopecSyncStartAction(input: { startDate: string; expectedStart: string }): Promise<
  | { ok: true; data: CopecSyncStartOptions }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:import")
  if (guard.error) return guard.error
  try {
    const parsed = copecStartDateSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: "La fecha de inicio no es válida" }
    return { ok: true, data: await setCopecSyncStartDate(parsed.data.startDate, parsed.data.expectedStart) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible actualizar la fecha de inicio" }
  }
}

export async function runCopecSyncPeriodAction(period: { from: string; to: string }): Promise<
  | { ok: true; imported: number; received: number; pending: number; unavailable: string[]; reports: number; unmappedCards: string[] }
  | { ok: false; message: string }
> {
  const guard = await guardPermission("combustibles:import")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsedPeriod = copecPeriodSchema.safeParse(period)
    if (!parsedPeriod.success || parsedPeriod.data.from > parsedPeriod.data.to) {
      return { ok: false, message: "El período de Copec no es válido" }
    }

    const plan = await getCopecSyncPlan()
    const expected = plan.periods[0]
    if (!expected || expected.from !== parsedPeriod.data.from || expected.to !== parsedPeriod.data.to) {
      return { ok: false, message: "El período ya no corresponde al siguiente tramo pendiente. Actualiza e inténtalo nuevamente." }
    }

    // La acción manual usa al operador autenticado. El importador configurado
    // queda reservado para el cron, que no tiene sesión de usuario.
    const result = await syncCopecReportPeriod(parsedPeriod.data, session.user.id)
    return { ok: true, imported: result.imported, received: result.received, pending: result.pending, unavailable: result.unavailable, reports: result.reports.length, unmappedCards: result.unmappedCards }
  } catch (error) {
    // Los errores de Playwright arrastran el "Call log:" completo -kilobytes de
    // reintentos- y el toast del operador, que persiste hasta cerrarlo a mano,
    // los mostraba enteros. El motivo siempre va en la primera linea.
    const message = error instanceof Error ? (error.message.split(/\r?\nCall log:/)[0] ?? "").trim() : ""
    return { ok: false, message: message || "No fue posible sincronizar Copec" }
  }
}
