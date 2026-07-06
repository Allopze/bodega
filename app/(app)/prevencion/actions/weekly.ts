"use server"

import { revalidatePath } from "next/cache"
import { guardAuth, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getWeeklyEvaluations, markWeekCompleted } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import { sstWeeklyEvaluations } from "@/db/schema/sst"
import { scopeToIds, REVALIDATE } from "./helpers"

export async function getWeeklyEvaluationsAction(
  evaluationId: string,
): Promise<ActionState & { data?: { weeks: typeof sstWeeklyEvaluations.$inferSelect[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:view", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos." }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const weeks = await getWeeklyEvaluations(evaluationId, worksiteIds)
    return { ok: true, data: { weeks } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener semanas" }
  }
}

export async function markWeekCompletedAction(weeklyEvalId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:create", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos para marcar semanas." }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await markWeekCompleted(weeklyEvalId, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Semana marcada como completada" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al marcar semana" }
  }
}
