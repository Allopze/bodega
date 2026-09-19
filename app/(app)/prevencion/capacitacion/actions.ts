"use server"

import { revalidatePath } from "next/cache"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordTrainingOccurrenceStatus } from "@/lib/services/prevention-training-occurrences"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/capacitacion"

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
    return {
      ok: true,
      message: result.status === "completed"
        ? "Capacitación marcada como hecha."
        : "Capacitación marcada como no hecha.",
    }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo actualizar la capacitación.") }
  }
}
