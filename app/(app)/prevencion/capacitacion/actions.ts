"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  acknowledgeTraining,
  cancelTrainingSession,
  closeTrainingSession,
  convalidateCompetency,
  createCompetencyRequirement,
  createTrainingCourse,
  createTrainingCourseVersion,
  createTrainingSession,
  escalateBlockingGapsToCapa,
  recordTrainingAttendance,
  revokeCompetency,
  transitionTrainingCourseVersion,
  type TrainingAccess,
} from "@/lib/services/prevention-training"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/capacitacion"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): TrainingAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// El `guardPermission` se resuelve en cada acción y no dentro de este helper:
// así la autorización de cada entrada queda verificable leyendo la acción, sin
// seguir una indirección. `run` sólo ejecuta y revalida.
async function run(access: TrainingAccess, operation: (access: TrainingAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/competencias`)
    revalidatePath(`${BASE}/brechas`)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createTrainingCourseAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createTrainingCourse(input, access))
}

export async function createTrainingCourseVersionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createTrainingCourseVersion(input, access))
}

export async function transitionTrainingCourseVersionAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  const permission: Permission = toStatus === "approved" || toStatus === "published"
    ? "prevention:training:approve"
    : "prevention:training:manage"
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionTrainingCourseVersion(input, access))
}

export async function createTrainingSessionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createTrainingSession(input, access))
}

export async function recordTrainingAttendanceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:deliver")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordTrainingAttendance(input, access))
}

export async function closeTrainingSessionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:deliver")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeTrainingSession(input, access))
}

export async function cancelTrainingSessionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => cancelTrainingSession(input, access))
}

export async function acknowledgeTrainingAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:ack")
  if (guard.error) return guard.error
  const headerList = await headers()
  const context = {
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent"),
  }
  return run(accessFromSession(guard.session), (access) => acknowledgeTraining(input, access, context))
}

export async function convalidateCompetencyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:convalidate")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => convalidateCompetency(input, access))
}

export async function revokeCompetencyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:revoke")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => revokeCompetency(input, access))
}

export async function createCompetencyRequirementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createCompetencyRequirement(input, access))
}

export async function escalateBlockingGapsAction(input: { targetDate: string; responsibleUserId?: string | null }): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => escalateBlockingGapsToCapa(access, input))
}
