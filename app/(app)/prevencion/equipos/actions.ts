"use server"

import { revalidatePath } from "next/cache"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createEquipmentReport,
  reviewEquipmentReport,
  createEquipmentChecklist,
  closeEquipmentChecklist,
} from "@/lib/services/prevention-equipment"
import { describeActiveRestrictions } from "@/lib/services/prevention-health"
import {
  equipmentDailyReportSchema,
  equipmentReportReviewSchema,
  equipmentChecklistSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE_REPORTES = "/prevencion/equipos/reportes"
const REVALIDATE_CHECKLISTS = "/prevencion/equipos/checklists"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

/* ── Daily reports ──────────────────────────────────────────────────────── */

export async function createEquipmentReportAction(
  input: Parameters<typeof createEquipmentReport>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:equipment_reports:manage")) {
    return { ok: false, message: "No tienes permisos para registrar reportes de equipos." }
  }
  const parsed = equipmentDailyReportSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const scope = scopeToIds(resolveWorksiteScope(session))
    const row = await createEquipmentReport(parsed.data, session.user.id, scope)
    if (!row) throw new Error("No se pudo registrar el reporte.")
    revalidatePath(REVALIDATE_REPORTES)
    const restrictionWarning = await describeActiveRestrictions(parsed.data.operatorWorkerId, scope).catch(() => null)
    return { ok: true, data: { id: row.id }, message: restrictionWarning ?? undefined }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function reviewEquipmentReportAction(
  input: Parameters<typeof reviewEquipmentReport>[0],
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:equipment_reports:manage")) {
    return { ok: false, message: "No tienes permisos para revisar reportes de equipos." }
  }
  const parsed = equipmentReportReviewSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await reviewEquipmentReport(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE_REPORTES)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/* ── Checklists ─────────────────────────────────────────────────────────── */

export async function createEquipmentChecklistAction(
  input: Parameters<typeof createEquipmentChecklist>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:equipment_reports:manage")) {
    return { ok: false, message: "No tienes permisos para registrar checklists de equipos." }
  }
  const parsed = equipmentChecklistSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createEquipmentChecklist(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    if (!row) throw new Error("No se pudo registrar el checklist.")
    revalidatePath(REVALIDATE_CHECKLISTS)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function closeEquipmentChecklistAction(checklistId: string): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:equipment_reports:manage")
  if (error) return error
  try {
    await closeEquipmentChecklist(checklistId, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE_CHECKLISTS)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
