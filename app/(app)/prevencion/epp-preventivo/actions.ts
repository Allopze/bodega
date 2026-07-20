"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createEppRequirement,
  escalateBlockingEppGapsToCapa,
  type EppAccess,
} from "@/lib/services/prevention-epp"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/epp-preventivo"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): EppAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: EppAccess, operation: (access: EppAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createEppRequirementAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:epp:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createEppRequirement(input, access))
}

export async function escalateBlockingEppGapsAction(input: { targetDate: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:epp:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => escalateBlockingEppGapsToCapa(access, input))
}
