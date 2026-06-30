"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { ActionState } from "@/lib/validation/prevention"
import {
  createInspectionTemplate,
  listInspectionTemplates,
  createInspectionRun,
  listInspectionRuns,
  getInspectionRun,
  updateInspectionItem,
  closeInspectionRun,
  addBehavioralObservation,
  listBehavioralObservations,
} from "@/lib/services/prevention-inspections"

const REVALIDATE = "/prevencion/inspecciones"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listInspectionRunsAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  try {
    const items = await listInspectionRuns(scopeToIds(resolveWorksiteScope(session)))
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function getInspectionRunAction(runId: string): Promise<ActionState & { data?: unknown }> {
  const { session, error } = await guardAuth()
  if (error) return error
  try {
    const data = await getInspectionRun(runId, scopeToIds(resolveWorksiteScope(session)))
    if (!data) return { ok: false, message: "Inspección no encontrada." }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createInspectionRunAction(formData: FormData): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:inspections:manage")) {
    return { ok: false, message: "Sin permisos." }
  }
  try {
    await createInspectionRun({
      templateId: formData.get("templateId") as string,
      worksiteId: formData.get("worksiteId") as string,
    }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function updateInspectionItemAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:inspections:manage")) {
    return { ok: false, message: "Sin permisos." }
  }
  try {
    await updateInspectionItem(input, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function closeInspectionRunAction(runId: string, signature?: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:inspections:close")) {
    return { ok: false, message: "Sin permisos para cerrar inspecciones." }
  }
  try {
    await closeInspectionRun({ runId, signature }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addBehavioralObservationAction(formData: FormData): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:inspections:manage")) {
    return { ok: false, message: "Sin permisos." }
  }
  try {
    await addBehavioralObservation({
      worksiteId: formData.get("worksiteId") as string,
      workerId: formData.get("workerId") ?? undefined,
      antecedent: formData.get("antecedent") as string,
      behavior: formData.get("behavior") as string,
      consequence: formData.get("consequence") as string,
      severity: formData.get("severity") ?? "bajo",
      runId: formData.get("runId") ?? undefined,
    }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
