"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addCommitteeMember,
  closeCommitteeMeeting,
  closeManagementReview,
  constituteCommittee,
  createManagementReview,
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
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
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
