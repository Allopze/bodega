"use server"

import { revalidatePath } from "next/cache"
import { guardPermission, guardAuth, can, canAny } from "@/lib/auth/can"
import { getDefinition } from "@/lib/sst/definitions/index"
import { writableSectionIds } from "@/lib/sst/checklist"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  listEvaluationsGroupedByWorker,
  saveResponses,
  closeEvaluation,
  archiveEvaluationPdf,
  markFollowup,
  getFollowups,
  getWeeklyEvaluations,
  markWeekCompleted,
  saveActionPlanItem,
  deleteActionPlanItem,
  deleteEvaluation,
  getDashboardStats,
  type WorkerEvaluationGroup,
} from '@/lib/services/sst'
import type { ActionState } from "@/lib/validation/sst"
import type {
  SstEvaluation,
} from "@/db/schema/sst"
import { sstScheduledFollowups, sstWeeklyEvaluations } from "@/db/schema/sst"
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

/**
 * Determina el EvaluatorRole del usuario autenticado basándose en sus permisos.
 * - conductor_lider: tiene sst:evaluate_acompanamiento pero NO sst:create
 * - admin_contrato:  tiene sst:create y su rol en DB es rol-admin-contrato
 * - prevencionista_faena: tiene sst:create (fallback)
 */
function resolveEvaluatorRole(
  session: Awaited<ReturnType<typeof guardAuth>>['session'] extends infer S ? (S extends null ? never : NonNullable<S>) : never
): import('@/lib/sst/types').EvaluatorRole | undefined {
  const perms = session.user.permissions ?? []
  const roleNames: string[] = session.user.roles ?? []

  if (perms.includes('sst:evaluate_acompanamiento') && !perms.includes('sst:create')) {
    return 'conductor_lider'
  }
  if (perms.includes('sst:create')) {
    if (roleNames.includes('admin_contrato')) return 'admin_contrato'
    return 'prevencionista_faena'
  }
  return undefined
}


// ── createEvaluationAction ────────────────────────────────────────────────────

export async function createEvaluationAction(
  input: z.infer<typeof sstEvaluationCreateSchema>
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, 'sst:create', 'sst:evaluate_acompanamiento')) {
    return { ok: false, message: 'No tienes permisos para crear evaluaciones.' }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)
  const canCreateFullEvaluation = can(session, "sst:create")
  const canEvaluateAcompanamiento = can(session, "sst:evaluate_acompanamiento")

  if (!canCreateFullEvaluation && canEvaluateAcompanamiento) {
    if (input.definicionCode !== "trabajador_nuevo" || input.tipo !== "nuevo") {
      return {
        ok: false,
        message: "El conductor líder solo puede iniciar evaluaciones de trabajador nuevo para acompañamiento.",
      }
    }
  }

  // Scope guard: user must have access to the target worksite
  if (worksiteIds !== 'all' && !worksiteIds.includes(input.worksiteId)) {
    return { ok: false, message: 'No tienes acceso a la faena seleccionada.' }
  }

  // Validate that the worker belongs to the selected worksite
  const worker = await db.select({ worksiteId: workers.worksiteId })
    .from(workers)
    .where(eq(workers.id, input.workerId))
    .then(r => r[0])
  if (!worker || worker.worksiteId !== input.worksiteId) {
    return { ok: false, message: 'El trabajador no pertenece a la faena seleccionada.' }
  }

  // Auto-detect evaluatorRole from session
  const evaluatorRole = resolveEvaluatorRole(session)

  try {
    const evaluation = await createEvaluation(input, session.user.id, evaluatorRole)
    revalidatePath(REVALIDATE)
    return { ok: true, message: 'Evaluación creada', data: { id: evaluation.id } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Error al crear la evaluación' }
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
  // Permite tanto a evaluadores plenos (sst:create) como a roles acotados a una
  // sección por permiso (p.ej. conductor_lider con sst:evaluate_acompanamiento).
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:create", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos para realizar esta acción" }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  // Refuerzo server-side: si el usuario no es evaluador pleno, solo puede escribir
  // las secciones que su permiso habilita (no basta con ocultarlas en la UI).
  const canCreate = can(session, "sst:create")
  if (!canCreate) {
    const evaluation = await getEvaluation(evaluationId, worksiteIds)
    if (!evaluation) return { ok: false, message: "Evaluación no encontrada o sin acceso." }
    const definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
    const allowed = writableSectionIds(definition, session.user.permissions ?? [], false)
    const invalid = responses.some((r) => !allowed.has(r.seccionId))
    if (invalid) {
      return { ok: false, message: "No tienes permisos para editar esta sección." }
    }
  }

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
    // Best-effort: guarda copia PDF en la biblioteca documental. Nunca lanza,
    // así que no puede convertir un cierre exitoso en un error de acción.
    await archiveEvaluationPdf(id, session)
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
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const saved = await saveActionPlanItem(input, worksiteIds)
    revalidatePath(`${REVALIDATE}/${input.evaluationId}`)
    return { ok: true, message: "Ítem del plan guardado", data: { id: saved.id } }
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

// ── deleteEvaluationAction ───────────────────────────────────────────────────

export async function deleteEvaluationAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const id = String(formData.get("evaluationId") ?? "")
  if (!id) return { ok: false, message: "Evaluación requerida" }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await deleteEvaluation(id, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Evaluación eliminada" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar la evaluación" }
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

// ── listWorkerEvaluationsAction ───────────────────────────────────────────────

export async function listWorkerEvaluationsAction(
  limit = 50,
  offset = 0
): Promise<ActionState & { data?: { workers: WorkerEvaluationGroup[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, 'sst:view', 'sst:evaluate_acompanamiento')) {
    return { ok: false, message: 'No tienes permisos para ver evaluaciones.' }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const workers = await listEvaluationsGroupedByWorker(worksiteIds, limit, offset)
    return { ok: true, data: { workers } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Error al listar evaluaciones por trabajador' }
  }
}

// ── getWeeklyEvaluationsAction ────────────────────────────────────────────────

export async function getWeeklyEvaluationsAction(
  evaluationId: string
): Promise<ActionState & { data?: { weeks: typeof sstWeeklyEvaluations.$inferSelect[] } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, 'sst:view', 'sst:evaluate_acompanamiento')) {
    return { ok: false, message: 'No tienes permisos.' }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const weeks = await getWeeklyEvaluations(evaluationId, worksiteIds)
    return { ok: true, data: { weeks } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Error al obtener semanas' }
  }
}

// ── markWeekCompletedAction ───────────────────────────────────────────────────

export async function markWeekCompletedAction(
  weeklyEvalId: string
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, 'sst:create', 'sst:evaluate_acompanamiento')) {
    return { ok: false, message: 'No tienes permisos para marcar semanas.' }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await markWeekCompleted(weeklyEvalId, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: 'Semana marcada como completada' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Error al marcar semana' }
  }
}
