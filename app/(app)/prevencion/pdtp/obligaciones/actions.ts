"use server"

import { revalidatePath } from "next/cache"
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

function scopeFromSession(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>): WorksiteScope {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

async function run(operation: (context: { userId: string; scope: WorksiteScope }) => Promise<unknown>): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:execute")
  if (guard.error) return guard.error
  try {
    await operation({ userId: guard.session!.user.id, scope: scopeFromSession(guard.session!) })
    revalidatePath("/prevencion/pdtp/obligaciones")
    revalidatePath("/prevencion/pdtp/aprobaciones")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    }
    return unexpectedActionError(error, "prevencion/pdtp/obligaciones/actions")
  }
}

export async function createPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run(({ userId, scope }) => {
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
  return run(({ userId, scope }) => {
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
  return run(({ userId, scope }) => cancelPdtpObligation({ ...pdtpObligationCancelSchema.parse(input), userId, scope }))
}
