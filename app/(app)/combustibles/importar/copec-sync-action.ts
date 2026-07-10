"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { getCopecSyncPlan, syncCopecReportPeriod } from "@/lib/combustibles/copec-sync"

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
