"use server"

import { ZodError } from "zod"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { CgrdAccess } from "@/lib/services/prevention-cgrd-access"
import {
  addGrdMember,
  constituteGrdCommittee,
  createGrdMatrixDraft,
  designateGrdCoordinator,
  dissolveGrdCommittee,
  endGrdCoordinator,
  addGrdThreat,
  publishGrdMatrix,
  recordGrdMeeting,
  removeGrdMember,
  removeGrdThreat,
} from "@/lib/services/prevention-cgrd"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/cgrd"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): CgrdAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: CgrdAccess, operation: (access: CgrdAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidateOperationalViews([REVALIDATE])
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    }
    return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
  }
}

export async function constituteGrdCommitteeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => constituteGrdCommittee(input, access))
}

export async function dissolveGrdCommitteeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => dissolveGrdCommittee(input, access))
}

export async function designateGrdCoordinatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => designateGrdCoordinator(input, access))
}

export async function endGrdCoordinatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => endGrdCoordinator(input, access))
}

export async function addGrdMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addGrdMember(input, access))
}

export async function removeGrdMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:committee:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removeGrdMember(input, access))
}

export async function createGrdMatrixDraftAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:matrix:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createGrdMatrixDraft(input, access))
}

export async function addGrdThreatAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:matrix:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addGrdThreat(input, access))
}

export async function removeGrdThreatAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:matrix:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removeGrdThreat(input, access))
}

export async function publishGrdMatrixAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:matrix:publish")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => publishGrdMatrix(input, access))
}

export async function recordGrdMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:meeting:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordGrdMeeting(input, access))
}
