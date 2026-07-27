"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  submitPdtpProgramForReview,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  rejectPdtpApprovalStep,
  reopenRejectedPdtpProgram,
  archivePdtpProgram,
  decidePdtpApprovalStep,
  getPdtpApprovalStep,
  getPdtpProgram,
  assertAllRequiredPdtpApprovalStepsApproved,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpApprovalDecisionSchema,
  pdtpProgramLifecycleReasonSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return unexpectedActionError(error, "prevencion/pdtp/actions/program-lifecycle")
}

async function activatePdtpIfAllStepsApproved(programId: string, userId: string): Promise<void> {
  const program = await getPdtpProgram(programId)
  if (!program || program.status !== "in_review" || !program.contentDigest) return
  try {
    await assertAllRequiredPdtpApprovalStepsApproved(programId, program.contentVersion, program.contentDigest)
  } catch {
    return
  }
  await activatePdtpProgram(programId, userId)
}

export async function submitPdtpProgramForReviewAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:submit_review")
  if (guard.error) return guard.error
  try {
    await submitPdtpProgramForReview(programId, guard.session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function decidePdtpApprovalStepAction(input: unknown): Promise<ActionState> {
  const authGuard = await guardAuth()
  if (authGuard.error) return authGuard.error
  try {
    const parsed = pdtpApprovalDecisionSchema.parse(input)
    const step = await getPdtpApprovalStep(parsed.stepId)
    if (!step || step.programId !== parsed.programId) throw new Error("Paso de aprobación no encontrado.")
    if (!authGuard.session.user.permissions.includes(step.requiredPermission)) {
      return { ok: false, message: "No tienes permisos para realizar esta acción" }
    }
    await decidePdtpApprovalStep({
      programId: parsed.programId,
      stepId: parsed.stepId,
      actorUserId: authGuard.session.user.id,
      decision: parsed.decision,
      reason: parsed.reason,
    })
    if (parsed.decision === "approved") {
      await activatePdtpIfAllStepsApproved(parsed.programId, authGuard.session.user.id)
    }
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function approvePdtpProgramJdprAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await approvePdtpProgramJdpr(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function signPdtpProgramLegalAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:sign_legal")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await signPdtpProgramLegal(programId, session.user.id)
    await activatePdtpIfAllStepsApproved(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function activatePdtpProgramAction(programId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:activate")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await activatePdtpProgram(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

async function rejectPdtpProgramWithPermission(
  programId: string,
  stepCode: "jdpr" | "legal",
  reason: string,
  permission: "prevention:pdtp:approve" | "prevention:pdtp:sign_legal",
): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await rejectPdtpApprovalStep(parsed.programId, stepCode, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function rejectPdtpProgramAsJdprAction(programId: string, reason: string): Promise<ActionState> {
  return rejectPdtpProgramWithPermission(programId, "jdpr", reason, "prevention:pdtp:approve")
}

export async function rejectPdtpProgramAsLegalAction(programId: string, reason: string): Promise<ActionState> {
  return rejectPdtpProgramWithPermission(programId, "legal", reason, "prevention:pdtp:sign_legal")
}

export async function reopenRejectedPdtpProgramAction(programId: string, reason: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:lifecycle:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await reopenRejectedPdtpProgram(parsed.programId, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function archivePdtpProgramAction(programId: string, reason: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:lifecycle:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramLifecycleReasonSchema.parse({ programId, reason })
    await archivePdtpProgram(parsed.programId, guard.session.user.id, parsed.reason)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
