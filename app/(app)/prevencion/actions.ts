"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  saveResponses,
  closeEvaluation,
  markFollowup,
  getFollowups,
  saveActionPlanItem,
  deleteActionPlanItem,
  getDashboardStats,
} from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import type {
  SstEvaluation,
} from "@/db/schema/sst"
import { sstScheduledFollowups } from "@/db/schema/sst"
import type {
  sstEvaluationCreateSchema,
  sstResponsesBatchSchema,
  sstCloseEvaluationSchema,
  sstFollowupMarkSchema,
  sstActionPlanItemSchema,
} from "@/lib/validation/sst"
import type { z } from "zod"

const REVALIDATE = "/prevencion"

// Helper: convert WorksiteScope to string[] | 'all'
function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | 'all' {
  if (scope.mode === "all") return 'all'
  if (scope.mode === "none") return []
  return scope.ids
}

// ── createEvaluationAction ────────────────────────────────────────────────────

export async function createEvaluationAction(
  input: z.infer<typeof sstEvaluationCreateSchema>
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardPermission("sst:create")
  if (error) return error

  try {
    const evaluation = await createEvaluation(input, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Evaluación creada", data: { id: evaluation.id } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al crear la evaluación" }
  }
}

// ── listEvaluationsAction ─────────────────────────────────────────────────────

export async function listEvaluationsAction(
  filters?: { tipo?: string; estado?: string; workerId?: string },
  limit = 50,
  offset = 0
): Promise<ActionState & { data?: { evaluations: (SstEvaluation & { workerName: string; worksiteName: string })[] } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const evaluations = await listEvaluations({ worksiteIds, ...filters }, limit, offset)
    return { ok: true, data: { evaluations } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al listar evaluaciones" }
  }
}

// ── getEvaluationAction ───────────────────────────────────────────────────────

export async function getEvaluationAction(
  id: string
): Promise<ActionState & { data?: { evaluation: SstEvaluation | null } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const evaluation = await getEvaluation(id, worksiteIds)
    return { ok: true, data: { evaluation } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener la evaluación" }
  }
}

// ── saveResponsesAction ───────────────────────────────────────────────────────

export async function saveResponsesAction(
  evaluationId: string,
  responses: z.infer<typeof sstResponsesBatchSchema>
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:create")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await saveResponses(evaluationId, responses, worksiteIds)
    revalidatePath(`${REVALIDATE}/${evaluationId}`)
    return { ok: true, message: "Respuestas guardadas" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar respuestas" }
  }
}

// ── closeEvaluationAction ─────────────────────────────────────────────────────

export async function closeEvaluationAction(
  id: string,
  input: z.infer<typeof sstCloseEvaluationSchema>
): Promise<ActionState & { data?: { evaluation: SstEvaluation } }> {
  const { session, error } = await guardPermission("sst:close")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const evaluation = await closeEvaluation(id, input, worksiteIds)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${id}`)
    return { ok: true, message: "Evaluación cerrada exitosamente", data: { evaluation } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al cerrar la evaluación" }
  }
}

// ── markFollowupAction ────────────────────────────────────────────────────────

export async function markFollowupAction(
  followupId: string,
  input: z.infer<typeof sstFollowupMarkSchema>
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await markFollowup(followupId, input, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Seguimiento actualizado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al actualizar el seguimiento" }
  }
}

// ── getFollowupsAction ────────────────────────────────────────────────────────

export async function getFollowupsAction(
  evaluationId: string
): Promise<ActionState & { data?: { followups: typeof sstScheduledFollowups.$inferSelect[] } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const followups = await getFollowups(evaluationId, worksiteIds)
    return { ok: true, data: { followups } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener seguimientos" }
  }
}

// ── saveActionPlanItemAction ──────────────────────────────────────────────────

export async function saveActionPlanItemAction(
  input: z.infer<typeof sstActionPlanItemSchema>
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:create")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await saveActionPlanItem(input, worksiteIds)
    revalidatePath(`${REVALIDATE}/${input.evaluationId}`)
    return { ok: true, message: "Ítem del plan guardado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar el ítem del plan" }
  }
}

// ── deleteActionPlanItemAction ────────────────────────────────────────────────

export async function deleteActionPlanItemAction(
  id: string
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await deleteActionPlanItem(id, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem eliminado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar el ítem" }
  }
}

// ── getDashboardStatsAction ───────────────────────────────────────────────────

export async function getDashboardStatsAction(): Promise<ActionState & {
  data?: {
    total: number
    borrador: number
    cerrado: number
    habilitados: number
    noHabilitados: number
    pendingFollowups: number
  }
}> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const stats = await getDashboardStats(worksiteIds)
    return { ok: true, data: stats }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener estadísticas" }
  }
}
