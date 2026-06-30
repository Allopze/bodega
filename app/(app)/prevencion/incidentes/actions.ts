"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createIncident,
  addIncidentAction,
  closeIncidentAction,
  closeIncident,
  listIncidents,
} from "@/lib/services/prevention-incidents"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/incidentes"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listIncidentsAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardAuth()
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
  try {
    const row = await createIncident(input, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
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
  try {
    await addIncidentAction(input, scopeToIds(resolveWorksiteScope(session)))
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