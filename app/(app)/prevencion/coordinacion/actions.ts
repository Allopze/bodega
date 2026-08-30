"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addPrescribedMeasure,
  closeExternalEngagement,
  createExternalEngagement,
  type EngagementAccess,
} from "@/lib/services/prevention-external-engagements"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/coordinacion"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): EngagementAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: EngagementAccess, operation: (access: EngagementAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    // Las medidas prescritas nacen como CAPA: su bandeja también cambia.
    revalidatePath("/prevencion/capa")
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo completar la operación.") }
  }
}

export async function createExternalEngagementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:engagement:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createExternalEngagement(input, access))
}

export async function addPrescribedMeasureAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:engagement:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addPrescribedMeasure(input, access))
}

export async function closeExternalEngagementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:engagement:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => closeExternalEngagement(input, access))
}
