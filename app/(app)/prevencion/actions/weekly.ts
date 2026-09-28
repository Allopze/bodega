"use server"

import { actionErrorResult } from "@/lib/actions/action-error-result"

import { revalidatePath } from "next/cache"
import { guardAuth, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { markWeekCompleted } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import { scopeToIds } from "./helpers"
import { REVALIDATE } from "./revalidate"

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
    return actionErrorResult(e, "Error al marcar semana")
  }
}
