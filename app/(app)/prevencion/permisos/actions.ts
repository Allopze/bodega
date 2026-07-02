"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createPermitTemplate,
  listPermitTemplates,
  createPermitRequest,
  listPermitRequests,
  approvePermitRequest,
  signPermit,
} from "@/lib/services/prevention-permits"
import {
  permitTemplateCreateSchema,
  permitRequestSchema,
  permitSignoffSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/permisos"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listPermitTemplatesAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { error } = await guardPermission("prevention:permits:view")
  if (error) return error
  try {
    const items = await listPermitTemplates()
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function listPermitRequestsAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardPermission("prevention:permits:view")
  if (error) return error
  try {
    const items = await listPermitRequests(scopeToIds(resolveWorksiteScope(session)))
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createPermitTemplateAction(
  input: Parameters<typeof createPermitTemplate>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { error } = await guardPermission("prevention:permits:manage")
  if (error) return error
  const parsed = permitTemplateCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createPermitTemplate(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createPermitRequestAction(
  input: Parameters<typeof createPermitRequest>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardPermission("prevention:permits:manage")
  if (error) return error
  const parsed = permitRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createPermitRequest(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function approvePermitRequestAction(permitId: string): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:permits:manage")
  if (error) return error
  try {
    await approvePermitRequest(permitId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function signPermitAction(
  input: Parameters<typeof signPermit>[0],
): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:permits:manage")
  if (error) return error
  const parsed = permitSignoffSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await signPermit(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
