"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  acknowledgePermitCrew,
  addPermitIsolation,
  addPermitMeasurement,
  applyPermitIsolation,
  createPermitType,
  createWorkPermit,
  extendWorkPermit,
  removePermitIsolation,
  saveJsaSteps,
  transitionWorkPermit,
  verifyPermitControl,
  type PermitAccess,
} from "@/lib/services/prevention-permits"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/permisos"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): PermitAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: PermitAccess, operation: (access: PermitAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

const TRANSITION_PERMISSION: Record<string, Permission> = {
  pending_approval: "prevention:permits:request",
  approved: "prevention:permits:approve",
  rejected: "prevention:permits:approve",
  active: "prevention:permits:activate",
  suspended: "prevention:permits:suspend",
  closed: "prevention:permits:close",
  cancelled: "prevention:permits:request",
}

export async function createPermitTypeAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createPermitType(input, access))
}

export async function createWorkPermitAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:request")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createWorkPermit(input, access))
}

export async function saveJsaStepsAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:request")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => saveJsaSteps(input, access))
}

export async function verifyPermitControlAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:verify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => verifyPermitControl(input, access))
}

export async function addPermitIsolationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:verify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addPermitIsolation(input, access))
}

export async function applyPermitIsolationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:verify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => applyPermitIsolation(input, access))
}

export async function removePermitIsolationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:verify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removePermitIsolation(input, access))
}

export async function addPermitMeasurementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:verify")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addPermitMeasurement(input, access))
}

export async function transitionWorkPermitAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  const permission = TRANSITION_PERMISSION[toStatus]
  if (!permission) return { ok: false, message: "Transición de permiso no soportada." }
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionWorkPermit(input, access))
}

export async function extendWorkPermitAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => extendWorkPermit(input, access))
}

export async function acknowledgePermitCrewAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:permits:view")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => acknowledgePermitCrew(input, access))
}
