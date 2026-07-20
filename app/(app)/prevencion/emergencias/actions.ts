"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addEmergencyContact,
  addEmergencyResource,
  addEmergencyRole,
  addEmergencyScenario,
  approveEmergencyPlan,
  completeEmergencyDrill,
  createEmergencyPlan,
  scheduleEmergencyDrill,
  type EmergencyAccess,
} from "@/lib/services/prevention-emergency"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/emergencias"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): EmergencyAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: EmergencyAccess, operation: (access: EmergencyAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/[planId]`, "page")
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createEmergencyPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createEmergencyPlan(input, access))
}

export async function addEmergencyScenarioAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addEmergencyScenario(input, access))
}

export async function addEmergencyRoleAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addEmergencyRole(input, access))
}

export async function addEmergencyResourceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addEmergencyResource(input, access))
}

export async function addEmergencyContactAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addEmergencyContact(input, access))
}

export async function approveEmergencyPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveEmergencyPlan(input, access))
}

export async function scheduleEmergencyDrillAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => scheduleEmergencyDrill(input, access))
}

export async function completeEmergencyDrillAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => completeEmergencyDrill(input, access))
}
