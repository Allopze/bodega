"use server"

import { revalidatePath } from "next/cache"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createIncident,
  addIncidentAction,
  closeIncidentAction,
  closeIncident,
  listIncidents,
} from "@/lib/services/prevention-incidents"
import { describeActiveRestrictions } from "@/lib/services/prevention-health"
import {
  preventionIncidentCreateSchema,
  preventionIncidentActionSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/incidentes"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listIncidentsAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardPermission("prevention:incidents:view")
  if (error) return error
  try {
    const items = await listIncidents(scopeToIds(resolveWorksiteScope(session)))
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createIncidentAction(
  input: Parameters<typeof createIncident>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:incidents:manage")) {
    return { ok: false, message: "No tienes permisos para registrar incidentes." }
  }
  const parsed = preventionIncidentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const scope = scopeToIds(resolveWorksiteScope(session))
    const row = await createIncident(parsed.data, session.user.id, scope)
    revalidatePath(REVALIDATE)
    const restrictionWarning = parsed.data.workerId
      ? await describeActiveRestrictions(parsed.data.workerId, scope).catch(() => null)
      : null
    return { ok: true, data: { id: row.id }, message: restrictionWarning ?? undefined }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addIncidentActionAction(
  input: Parameters<typeof addIncidentAction>[0],
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:incidents:manage")) {
    return { ok: false, message: "No tienes permisos para gestionar acciones." }
  }
  const parsed = preventionIncidentActionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addIncidentAction(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function closeIncidentActionAction(
  actionId: string,
  finalStatus: "cerrada" | "cancelada",
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:incidents:manage")) {
    return { ok: false, message: "No tienes permisos para cerrar acciones." }
  }
  try {
    await closeIncidentAction(actionId, finalStatus, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function closeIncidentActionFlow(incidentId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:incidents:close")) {
    return { ok: false, message: "No tienes permisos para cerrar investigaciones." }
  }
  try {
    await closeIncident(incidentId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}