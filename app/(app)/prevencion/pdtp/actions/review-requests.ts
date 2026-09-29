"use server"

import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardAnyPermission, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  requestPdtpExecutionAnnulment,
  reviewPdtpReviewRequest,
  withdrawPdtpReviewRequest,
} from "@/lib/services/pdtp/review-requests"
import type { ActionState } from "@/lib/validation/prevention"

/**
 * PRV-05 / PRV-12 (auditoría 2026-09-28): solicitudes que sacan algo del
 * cumplimiento —cancelar una obligación, anular una aprobación—. Las revisa
 * alguien con `prevention:pdtp:approve` distinto de quien las pidió; el
 * servicio lo impone y la base también (CHECK).
 */

const REVALIDATE = ["/prevencion/pdtp", "/prevencion/pdtp/aprobaciones", "/prevencion/pdtp/obligaciones"]

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
  }
  return actionErrorResult(error, "No se pudo completar la acción. Intenta nuevamente.")
}

export async function requestPdtpExecutionAnnulmentAction(input: { executionId: string; reason: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  try {
    await requestPdtpExecutionAnnulment({ targetId: input.executionId, reason: input.reason }, guard.session.user.id, scopeToIds(resolveWorksiteScope(guard.session)))
    revalidateOperationalViews(REVALIDATE)
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

export async function reviewPdtpReviewRequestAction(input: { requestId: string; decision: "approve" | "reject"; reason?: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  try {
    await reviewPdtpReviewRequest(input, guard.session.user.id, scopeToIds(resolveWorksiteScope(guard.session)))
    revalidateOperationalViews(REVALIDATE)
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

export async function withdrawPdtpReviewRequestAction(requestId: string): Promise<ActionState> {
  const guard = await guardAnyPermission(["prevention:pdtp:approve", "prevention:pdtp:obligation:cancel"])
  if (guard.error) return guard.error
  try {
    await withdrawPdtpReviewRequest(requestId, guard.session.user.id)
    revalidateOperationalViews(REVALIDATE)
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}
