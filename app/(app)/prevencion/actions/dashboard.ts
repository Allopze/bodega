"use server"

import { guardAuth, guardPermission, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDashboardStats, listEvaluationsGroupedByWorker } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import { scopeToIds } from "./helpers"

export async function getDashboardStatsAction(): Promise<
  ActionState & {
    data?: {
      total: number
      borrador: number
      cerrado: number
      habilitados: number
      noHabilitados: number
      pendingFollowups: number
    }
  }
> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const stats = await getDashboardStats(worksiteIds)
    return { ok: true, data: stats }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener estadísticas" }
  }
}

export async function listWorkerEvaluationsAction(
  limit = 50,
  offset = 0,
): Promise<ActionState & { data?: { workers: import("@/lib/services/sst").WorkerEvaluationGroup[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:view", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos para ver evaluaciones." }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const workers = await listEvaluationsGroupedByWorker(worksiteIds, limit, offset)
    return { ok: true, data: { workers } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al listar evaluaciones por trabajador" }
  }
}
