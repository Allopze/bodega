"use server"

import { revalidatePath } from "next/cache"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordTrainingOccurrenceStatus } from "@/lib/services/prevention-training-occurrences"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/capacitacion"

// Un mapa y no un ternario: con dos ramas, «No aplica» caía en «no hecha» y el
// aviso contradecía lo que la persona acababa de declarar.
const STATUS_MESSAGES: Record<string, string> = {
  completed: "Capacitación marcada como hecha.",
  not_completed: "Capacitación marcada como no hecha.",
  not_applicable: "Capacitación declarada como no aplicable.",
}

/**
 * La única acción del módulo: marcar una ocurrencia como hecha o no hecha.
 *
 * Hasta el 2026-09-19 acá vivían además trece acciones del modelo por persona
 * —alta de cursos, ciclo de versiones, sesiones, asistencia, acuse,
 * convalidación y revocación de competencias, escalamiento de brechas a CAPA—.
 * Se retiraron con ese modelo.
 */
export async function recordTrainingOccurrenceStatusAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:training:record")
  if (guard.error) return guard.error
  try {
    const result = await recordTrainingOccurrenceStatus(input, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(BASE)
    return { ok: true, message: STATUS_MESSAGES[result.status] ?? "Capacitación actualizada." }
  } catch (error) {
    return actionErrorResult(error, "No se pudo actualizar la capacitación.")
  }
}
