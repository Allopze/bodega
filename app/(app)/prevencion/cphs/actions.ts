"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  activateProgram,
  addProgramActivity,
  cancelProgramActivity,
  closeProgram,
  completeProgramActivity,
  createProgram,
  linkActivityToMeeting,
} from "@/lib/services/prevention-cphs-program"
import {
  createCertificationDossier,
  recordAuditResult,
  recordManualEvaluation,
  reopenCertificationDossier,
  submitCertificationDossier,
  updateDossierAdministrativeData,
} from "@/lib/services/prevention-cphs-certification"
import {
  addCommitteeMember,
  addMeetingGuest,
  assignCommissionMember,
  cancelCommitteeMeeting,
  closeCommitteeMeeting,
  closeManagementReview,
  constituteCommittee,
  createCommission,
  createManagementReview,
  dissolveCommittee,
  markAgendaSent,
  markMinutesSentToManagement,
  replaceCommitteeMember,
  resignCommitteeMember,
  scheduleCommitteeMeeting,
  type CphsAccess,
} from "@/lib/services/prevention-cphs"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/cphs"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): CphsAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: CphsAccess, operation: (access: CphsAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    // Sin esto un integrante o una sesión recién guardada sigue mostrando el
    // valor anterior al volver al detalle, porque la ruta dinámica no la
    // cubre `BASE`.
    revalidatePath(`${BASE}/[committeeId]`, "page")
    revalidatePath(`${BASE}/[committeeId]/programa`, "page")
    revalidatePath(`${BASE}/[committeeId]/certificacion`, "page")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return { ok: false, message: safeActionMessage(error, "No se pudo completar la operación.") }
  }
}

export async function constituteCommitteeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => constituteCommittee(input, access))
}

export async function addCommitteeMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addCommitteeMember(input, access))
}

export async function scheduleCommitteeMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => scheduleCommitteeMeeting(input, access))
}

export async function closeCommitteeMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeCommitteeMeeting(input, access))
}

export async function createManagementReviewAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:governance:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createManagementReview(input, access))
}

export async function closeManagementReviewAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:governance:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeManagementReview(input, access))
}

/* ── Ciclo de vida del comité ─────────────────────────────────────────────── */

export async function dissolveCommitteeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => dissolveCommittee(input, access))
}

export async function resignCommitteeMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resignCommitteeMember(input, access))
}

export async function replaceCommitteeMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => replaceCommitteeMember(input, access))
}

export async function cancelCommitteeMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => cancelCommitteeMeeting(input, access))
}

/* ── Programa de trabajo del comité ───────────────────────────────────────── */

export async function createProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createProgram(input, access))
}

export async function activateProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => activateProgram(input, access))
}

export async function closeProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeProgram(input, access))
}

export async function addProgramActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addProgramActivity(input, access))
}

export async function completeProgramActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => completeProgramActivity(input, access))
}

export async function cancelProgramActivityAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => cancelProgramActivity(input, access))
}

export async function linkActivityToMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => linkActivityToMeeting(input, access))
}

/* ── Certificación Mutual ─────────────────────────────────────────────────── */

export async function createCertificationDossierAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createCertificationDossier(input, access))
}

export async function updateDossierAdministrativeDataAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => updateDossierAdministrativeData(input, access))
}

export async function recordManualEvaluationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordManualEvaluation(input, access))
}

export async function submitCertificationDossierAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => submitCertificationDossier(input, access))
}

export async function recordAuditResultAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordAuditResult(input, access))
}

export async function reopenCertificationDossierAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:certify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => reopenCertificationDossier(input, access))
}

/* ── Prácticas de madurez (Plata y Oro) ───────────────────────────────────── */

export async function markAgendaSentAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => markAgendaSent(input, access))
}

export async function markMinutesSentToManagementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => markMinutesSentToManagement(input, access))
}

export async function addMeetingGuestAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addMeetingGuest(input, access))
}

export async function createCommissionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createCommission(input, access))
}

export async function assignCommissionMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => assignCommissionMember(input, access))
}
