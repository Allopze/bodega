"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import {
  upsertPdtpObjective,
  deletePdtpObjective,
  reorderPdtpObjectives,
  setPdtpActivityObjective,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"

const ROOT = "/prevencion/pdtp"

/**
 * Los objetivos se leen en tres lugares: el editor (formulario y select por
 * actividad), la ficha del programa activo y el visor transversal de
 * actividades (filtro `?objetivo=`). Las cuatro acciones de este archivo
 * revalidan las mismas cuatro rutas para no dejar ninguna con dato viejo.
 */
function revalidateProgram(programId: string) {
  revalidatePath(ROOT)
  revalidatePath(`${ROOT}/${programId}`)
  revalidatePath(`${ROOT}/${programId}/editar`)
  revalidatePath(`${ROOT}/actividades`)
}

export async function upsertPdtpObjectiveAction(input: {
  programId: string
  id?: string
  code: string
  name: string
}): Promise<ActionState & { objectiveId?: string }> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input || typeof input.programId !== "string" || input.programId.trim().length === 0
    || typeof input.code !== "string" || input.code.trim().length === 0
    || typeof input.name !== "string" || input.name.trim().length === 0
    || (input.id !== undefined && typeof input.id !== "string")) {
    return { ok: false, message: "El objetivo no es válido: código y nombre son obligatorios." }
  }
  try {
    const objective = await upsertPdtpObjective({
      programId: input.programId,
      id: input.id,
      code: input.code,
      name: input.name,
    }, guard.session.user.id)
    revalidateProgram(input.programId)
    return { ok: true, objectiveId: objective.id }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo guardar el objetivo.") }
  }
}

export async function deletePdtpObjectiveAction(input: {
  programId: string
  objectiveId: string
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input || typeof input.programId !== "string" || input.programId.trim().length === 0
    || typeof input.objectiveId !== "string" || input.objectiveId.trim().length === 0) {
    return { ok: false, message: "El objetivo a eliminar no es válido." }
  }
  try {
    await deletePdtpObjective({ programId: input.programId, objectiveId: input.objectiveId }, guard.session.user.id)
    revalidateProgram(input.programId)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo eliminar el objetivo.") }
  }
}

export async function reorderPdtpObjectivesAction(input: {
  programId: string
  orderedIds: string[]
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input || typeof input.programId !== "string" || input.programId.trim().length === 0
    || !Array.isArray(input.orderedIds) || input.orderedIds.length === 0
    || input.orderedIds.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    return { ok: false, message: "El orden de objetivos no es válido." }
  }
  try {
    await reorderPdtpObjectives({ programId: input.programId, orderedIds: input.orderedIds }, guard.session.user.id)
    revalidateProgram(input.programId)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo reordenar los objetivos.") }
  }
}

export async function setPdtpActivityObjectiveAction(input: {
  programId: string
  activityId: string
  objectiveId: string | null
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input || typeof input.programId !== "string" || input.programId.trim().length === 0
    || typeof input.activityId !== "string" || input.activityId.trim().length === 0
    || (input.objectiveId !== null && typeof input.objectiveId !== "string")) {
    return { ok: false, message: "El objetivo de la actividad no es válido." }
  }
  try {
    await setPdtpActivityObjective({
      programId: input.programId,
      activityId: input.activityId,
      objectiveId: input.objectiveId,
    }, guard.session.user.id)
    revalidateProgram(input.programId)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo actualizar el objetivo de la actividad.") }
  }
}
