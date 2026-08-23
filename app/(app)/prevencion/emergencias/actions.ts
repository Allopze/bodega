"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { parseZ } from "@/lib/actions/parse-z"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  addEmergencyContact,
  addEmergencyRole,
  addEmergencyScenario,
  approveEmergencyPlan,
  archiveEmergencyPlan,
  cancelEmergencyDrill,
  completeEmergencyDrill,
  createEmergencyPlan,
  EmergencyDomainError,
  planSchema,
  scheduleEmergencyDrill,
  setEmergencyPlanPdtpActivities,
  updateEmergencyResource,
  type EmergencyAccess,
} from "@/lib/services/prevention-emergency"
import { linkResourcesToPlan } from "@/lib/services/worksite-inventory"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/emergencias"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): EmergencyAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
//
// Fase 7: antes se devolvía `error.message` de CUALQUIER Error, así que el
// contrato que `EmergencyDomainError` prometía —no filtrar detalles de
// infraestructura al navegador— no lo cumplía nadie. Ahora sólo el error de
// dominio viaja con su mensaje; el resto pasa por `unexpectedActionError`, que
// loguea y responde genérico. Mismo criterio que `campaignFailure` en
// prevencion/campanas/actions.ts.
async function run(access: EmergencyAccess, action: string, operation: (access: EmergencyAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/[planId]`, "page")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    if (error instanceof EmergencyDomainError) return { ok: false, message: error.message }
    return unexpectedActionError(error, `prevencion/emergencias/${action}`)
  }
}

export async function createEmergencyPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  // Boundary de validación con parseZ (Fase 1 H-27): antes, un input
  // inválido caía en el catch de `run()` y devolvía el mensaje crudo de
  // ZodError sin fieldErrors. Ahora se rechaza aquí con fieldErrors
  // estructurados — mejora intencional, no un cambio de comportamiento
  // en el camino exitoso.
  const parsed = parseZ(planSchema, input)
  if (!parsed.ok) return parsed
  return run(accessFromSession(guard.session), "createEmergencyPlan", (access) => createEmergencyPlan(parsed.data, access))
}

export async function addEmergencyScenarioAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "addEmergencyScenario", (access) => addEmergencyScenario(input, access))
}

export async function addEmergencyRoleAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "addEmergencyRole", (access) => addEmergencyRole(input, access))
}

/**
 * Declara en el plan recursos que ya existen en el inventario de la faena.
 *
 * Reemplaza al alta (`addEmergencyResource`, que exigía un plan en borrador y
 * creaba el equipo): el padrón físico se carga en Administración → Inventario de
 * faena, porque existe por la operación y no por el documento que lo declara.
 * Acá sólo se elige, con el mismo permiso de siempre.
 */
export async function linkResourcesToPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  const session = guard.session
  if (!session) return { ok: false, message: "Sesión no disponible." }
  return run(accessFromSession(session), "linkResourcesToPlan", () => linkResourcesToPlan(input, session.user.id))
}

export async function addEmergencyContactAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "addEmergencyContact", (access) => addEmergencyContact(input, access))
}

export async function updateEmergencyResourceAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "updateEmergencyResource", (access) => updateEmergencyResource(input, access))
}

export async function setEmergencyPlanPdtpActivitiesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "setEmergencyPlanPdtpActivities", (access) => setEmergencyPlanPdtpActivities(input, access))
}

export async function approveEmergencyPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "approveEmergencyPlan", (access) => approveEmergencyPlan(input, access))
}

export async function archiveEmergencyPlanAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "archiveEmergencyPlan", (access) => archiveEmergencyPlan(input, access))
}

export async function scheduleEmergencyDrillAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "scheduleEmergencyDrill", (access) => scheduleEmergencyDrill(input, access))
}

export async function completeEmergencyDrillAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "completeEmergencyDrill", (access) => completeEmergencyDrill(input, access))
}

export async function cancelEmergencyDrillAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), "cancelEmergencyDrill", (access) => cancelEmergencyDrill(input, access))
}
