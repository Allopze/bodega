"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { designateDelegate, endDelegate } from "@/lib/services/prevention-cphs-organization"
import { recordCommitteeDtRegistration, type CphsAccess } from "@/lib/services/prevention-cphs"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/faenas"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): CphsAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: CphsAccess, operation: (access: CphsAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(BASE)
    revalidatePath(`${BASE}/[worksiteId]`, "page")
    revalidatePath("/prevencion/cphs")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function designateDelegateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => designateDelegate(input, access))
}

export async function endDelegateAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => endDelegate(input, access))
}

export async function recordDtRegistrationAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:cphs:manage")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => recordCommitteeDtRegistration(input, access))
}
