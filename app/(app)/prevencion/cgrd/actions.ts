"use server"

import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { CgrdAccess } from "@/lib/services/prevention-cgrd-access"
import {
  addGrdMember,
  annulGrdMeeting,
  constituteGrdCommittee,
  createGrdMatrixDraft,
  designateGrdCoordinator,
  dissolveGrdCommittee,
  endGrdCoordinator,
  addGrdThreat,
  publishGrdMatrix,
  recordGrdMeeting,
  recordGrdMeetingSlotStatus,
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

/**
 * #43: un órgano activo por faena y un integrante activo una vez por comité
 * los sostiene sólo un índice único parcial (`db/schema/prevention/cgrd.ts`).
 * En una carrera la segunda alta llega al índice; sin este mapa el usuario
 * veía un error genérico.
 */
const CGRD_UNIQUE_MESSAGES: Record<string, string> = {
  prevention_grd_committee_active_worksite_unique: "Esta faena ya tiene un comité GRD activo. Disuélvelo antes de constituir otro.",
  prevention_grd_coordinator_active_unique: "Esta faena ya tiene un coordinador GRD vigente. Termina su designación antes de designar otro.",
  prevention_grd_member_unique: "Esa persona ya es integrante activo de este comité.",
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
    return actionErrorResult(error, "No se pudo completar la acción. Intenta nuevamente.", { unique: CGRD_UNIQUE_MESSAGES })
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

export async function annulGrdMeetingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:meeting:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => annulGrdMeeting(input, access))
}

/** Declara una casilla del programa como no hecha o no aplicable. */
export async function recordGrdMeetingSlotStatusAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cgrd:meeting:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordGrdMeetingSlotStatus(input, access))
}
