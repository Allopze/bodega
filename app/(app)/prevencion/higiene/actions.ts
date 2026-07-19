"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addExposureGroupMember,
  createExposureAgent,
  createExposureGroup,
  createSurveillanceProgram,
  enrollGroupInSurveillance,
  recordExposureMeasurement,
  recordSurveillanceOutcome,
  type HygieneAccess,
} from "@/lib/services/prevention-hygiene"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/higiene"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): HygieneAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: HygieneAccess, operation: (access: HygieneAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createExposureAgentAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createExposureAgent(input, access))
}

export async function createExposureGroupAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createExposureGroup(input, access))
}

export async function addExposureGroupMemberAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addExposureGroupMember(input, access))
}

export async function recordExposureMeasurementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:measure")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordExposureMeasurement(input, access))
}

export async function createSurveillanceProgramAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createSurveillanceProgram(input, access))
}

export async function enrollGroupInSurveillanceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => enrollGroupInSurveillance(input, access))
}

export async function recordSurveillanceOutcomeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:hygiene:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordSurveillanceOutcome(input, access))
}
