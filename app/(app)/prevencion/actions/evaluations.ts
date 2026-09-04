"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { logger } from "@/lib/logger"
import { guardPermission, guardAuth, can, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  closeEvaluation,
  archiveEvaluationPdf,
  deleteEvaluation,
} from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import type { SstEvaluation } from "@/db/schema/sst"
import type { sstEvaluationCreateSchema, sstCloseEvaluationSchema } from "@/lib/validation/sst"
import type { z } from "zod"
import { scopeToIds, resolveEvaluatorRole } from "./helpers"
import { REVALIDATE } from "./revalidate"
import { isPersonEvaluationDefinition } from "@/lib/sst/definitions"

// ── createEvaluationAction ────────────────────────────────────────────────────

export async function createEvaluationAction(
  input: z.infer<typeof sstEvaluationCreateSchema>,
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:create", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos para crear evaluaciones." }
  }

  if (!isPersonEvaluationDefinition(input.definicionCode)) {
    return {
      ok: false,
      message: "Esta definición corresponde a una inspección y debe ejecutarse desde el Programa de trabajo (PDTP).",
    }
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
  if (worksiteIds !== "all" && !worksiteIds.includes(input.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada." }
  }

  // Validate that the worker belongs to the selected worksite
  const worker = await db
    .select({ worksiteId: workers.worksiteId })
    .from(workers)
    .where(eq(workers.id, input.workerId))
    .then((r) => r[0])
  if (!worker || worker.worksiteId !== input.worksiteId) {
    return { ok: false, message: "El trabajador no pertenece a la faena seleccionada." }
  }

  // Auto-detect evaluatorRole from session
  const evaluatorRole = resolveEvaluatorRole(session)

  try {
    const evaluation = await createEvaluation(input, session.user.id, evaluatorRole)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Evaluación creada", data: { id: evaluation.id } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al crear la evaluación") }
  }
}

// ── listEvaluationsAction ─────────────────────────────────────────────────────

export async function listEvaluationsAction(
  filters?: { tipo?: string; estado?: string; workerId?: string },
  limit = 50,
  offset = 0,
): Promise<ActionState & { data?: { evaluations: (SstEvaluation & { workerName: string; worksiteName: string })[] } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const evaluations = await listEvaluations({ worksiteIds, ...filters }, limit, offset)
    return { ok: true, data: { evaluations } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al listar evaluaciones") }
  }
}

// ── getEvaluationAction ───────────────────────────────────────────────────────

export async function getEvaluationAction(
  id: string,
): Promise<ActionState & { data?: { evaluation: SstEvaluation | null } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const evaluation = await getEvaluation(id, worksiteIds)
    return { ok: true, data: { evaluation } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al obtener la evaluación") }
  }
}

// ── closeEvaluationAction ─────────────────────────────────────────────────────

export async function closeEvaluationAction(
  id: string,
  input: z.infer<typeof sstCloseEvaluationSchema>,
): Promise<ActionState & { data?: { evaluation: SstEvaluation } }> {
  const { session, error } = await guardPermission("sst:close")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  let evaluation: SstEvaluation
  try {
    evaluation = await closeEvaluation(id, input, worksiteIds, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${id}`)
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al cerrar la evaluación") }
  }

  // Best-effort: guarda copia PDF en la biblioteca documental. Se ejecuta
  // fuera del try de negocio, en su propio try/catch, para que un fallo aquí
  // nunca convierta un cierre ya persistido en un error de acción.
  try {
    await archiveEvaluationPdf(id, session)
  } catch (e) {
    logger.error("[closeEvaluationAction] archiveEvaluationPdf falló tras un cierre exitoso", e)
  }

  return { ok: true, message: "Evaluación cerrada exitosamente", data: { evaluation } }
}

// ── deleteEvaluationAction ───────────────────────────────────────────────────

export async function deleteEvaluationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const id = String(formData.get("evaluationId") ?? "")
  if (!id) return { ok: false, message: "Evaluación requerida" }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await deleteEvaluation(id, worksiteIds, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Evaluación eliminada" }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al eliminar la evaluación") }
  }
}
