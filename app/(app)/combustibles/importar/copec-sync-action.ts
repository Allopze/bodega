"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { systemSettings } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { getCopecSyncPlan, syncCopecReportPeriod } from "@/lib/combustibles/copec-sync"

const STATE_KEY = "combustibles.copec.sync"

export interface CopecSyncStatus {
  lastRunAt: string | null
  cursor: string | null
  pending: number
}

export async function getCopecSyncStatusAction(): Promise<
  | { ok: true; data: CopecSyncStatus }
  | { ok: false; message: string }
> {
  try {
    await requirePermission("combustibles:import")
    revalidatePath("/combustibles/importar")
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
  try {
    await requirePermission("combustibles:import")
    const result = await getCopecSyncPlan()
    return { ok: true, from: result.from, to: result.to, periods: result.periods }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible preparar la sincronización Copec" }
  }
}

export async function runCopecSyncPeriodAction(period: { from: string; to: string }): Promise<
  | { ok: true; imported: number; pending: number; unavailable: string[] }
  | { ok: false; message: string }
> {
  try {
    await requirePermission("combustibles:import")
    const result = await syncCopecReportPeriod(period)
    revalidatePath("/combustibles")
    revalidatePath("/combustibles/importar")
    return { ok: true, imported: result.imported, pending: result.pending, unavailable: result.unavailable }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible sincronizar Copec" }
  }
}
