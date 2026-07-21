"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { parseZ } from "@/lib/actions/parse-z"
import {
  approveChangeRequest,
  approveSchema,
  createChangeRequest,
  createSchema,
  evaluateChangeDimension,
  evaluateSchema,
  rejectChangeRequest,
  rejectSchema,
  type ChangeAccess,
} from "@/lib/services/prevention-change"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/gestion-cambio"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): ChangeAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

// La autorización se resuelve en cada acción, no dentro de este helper.
async function run(access: ChangeAccess, operation: (access: ChangeAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/[changeId]`, "page")
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createChangeRequestAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:change:manage")
  if (guard.error) return guard.error
  const parsed = parseZ(createSchema, input)
  if (!parsed.ok) return parsed
  return run(accessFromSession(guard.session), (access) => createChangeRequest(parsed.data, access))
}

export async function evaluateChangeDimensionAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:change:evaluate")
  if (guard.error) return guard.error
  const parsed = parseZ(evaluateSchema, input)
  if (!parsed.ok) return parsed
  return run(accessFromSession(guard.session), (access) => evaluateChangeDimension(parsed.data, access))
}

export async function approveChangeRequestAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:change:approve")
  if (guard.error) return guard.error
  const parsed = parseZ(approveSchema, input)
  if (!parsed.ok) return parsed
  return run(accessFromSession(guard.session), (access) => approveChangeRequest(parsed.data, access))
}

export async function rejectChangeRequestAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:change:approve")
  if (guard.error) return guard.error
  const parsed = parseZ(rejectSchema, input)
  if (!parsed.ok) return parsed
  return run(accessFromSession(guard.session), (access) => rejectChangeRequest(parsed.data, access))
}
