"use server"

import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  approvePdtpExecution,
  rejectPdtpExecution,
  markPdtpExecution,
} from "@/lib/services/prevention-pdtp"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { parseZ } from "@/lib/actions/parse-z"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpExecutionSchema,
  pdtpExecutionApprovalSchema,
  pdtpExecutionRejectionSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return unexpectedActionError(error, "prevencion/pdtp/actions/executions")
}

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:execute")
  if (guard.error) return guard.error
  const session = guard.session

  const evidenceUrl = formData.get("evidenceUrl")
  const parsed = parseZ(pdtpExecutionSchema, {
    activityId: formData.get("activityId"),
    worksiteId: formData.get("worksiteId"),
    year: formData.get("year"),
    month: formData.get("month"),
    week: formData.get("week"),
    executedQuantity: formData.get("executedQuantity"),
    evidenceText: formData.get("evidenceText") ?? "",
    evidenceUrl: evidenceUrl ?? "",
    evidencePhotos: [],
  })
  if (!parsed.ok) return parsed

  try {
    await markPdtpExecution(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<ActionState> {
  return markPdtpExecutionAction(formData)
}

export async function approvePdtpExecutionAction(executionId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionApprovalSchema.parse({ executionId })
    await approvePdtpExecution(parsed.executionId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function rejectPdtpExecutionAction(
  executionId: string,
  reason: string,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionRejectionSchema.parse({ executionId, reason })
    await rejectPdtpExecution(parsed.executionId, session.user.id, parsed.reason, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
