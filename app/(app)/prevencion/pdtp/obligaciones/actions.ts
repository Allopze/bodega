"use server"

import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  cancelPdtpObligation,
  createPdtpObligation,
  reportPdtpObligation,
  type WorksiteScope,
} from "@/lib/services/prevention-pdtp"
import {
  pdtpObligationCancelSchema,
  pdtpObligationCreateSchema,
  pdtpObligationReportSchema,
  type ActionState,
} from "@/lib/validation/prevention"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

function scopeFromSession(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>): WorksiteScope {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

/**
 * El permiso es un parámetro y no una constante del wrapper: reportar el
 * cumplimiento es trabajo de terreno (`execute`), pero anular el compromiso es
 * gestión y tiene su propio permiso.
 */
async function run(
  permission: "prevention:pdtp:execute" | "prevention:pdtp:obligation:cancel",
  operation: (context: { userId: string; scope: WorksiteScope }) => Promise<unknown>,
): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    await operation({ userId: guard.session!.user.id, scope: scopeFromSession(guard.session!) })
    revalidateOperationalViews(["/prevencion/pdtp/obligaciones", "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    }
    return unexpectedActionError(error, "prevencion/pdtp/obligaciones/actions")
  }
}

export async function createPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:execute", ({ userId, scope }) => {
    const parsed = pdtpObligationCreateSchema.parse(input)
    return createPdtpObligation({
      ...parsed,
      sourceType: parsed.sourceType ?? undefined,
      sourceId: parsed.sourceId ?? undefined,
      sourceOccurredAt: parsed.sourceOccurredAt ?? undefined,
      manualReason: parsed.manualReason ?? undefined,
      userId,
      scope,
    })
  })
}

export async function reportPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:execute", ({ userId, scope }) => {
    const parsed = pdtpObligationReportSchema.parse(input)
    return reportPdtpObligation({
      ...parsed,
      evidenceText: parsed.evidenceText ?? undefined,
      evidenceUrl: parsed.evidenceUrl ?? undefined,
      userId,
      scope,
    })
  })
}

export async function cancelPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:obligation:cancel", ({ userId, scope }) =>
    cancelPdtpObligation({ ...pdtpObligationCancelSchema.parse(input), userId, scope }))
}
