"use server"

import { revalidatePath } from "next/cache"
import { isNetworkError } from "@/lib/network-error"
import { guardPermission } from "@/lib/auth/can"
import { updateAnomalyCaseStatus, assignAnomalyCase, addAnomalyComment, METER_RESOLUTION_KINDS, type AnomalyCaseStatus, type MeterResolutionKind } from "@/lib/combustibles/anomaly-cases"
import { logger } from "@/lib/logger"

/** in_review/reopened son parte de la revisión; resolved/dismissed cierran el caso y requieren el permiso de resolución. */
const RESOLVING_STATUSES = new Set(["resolved", "dismissed"])
const VALID_CURRENT_STATUSES = new Set(["open", "in_review", "resolved", "dismissed", "reopened"])
// "open" queda fuera a propósito: es el estado inicial que pone el detector,
// no un destino de esta acción de revisión.
const VALID_TARGET_STATUSES = new Set(["in_review", "resolved", "dismissed", "reopened"])

export async function updateAnomalyStatusAction(input: { caseId: string; expectedStatus: AnomalyCaseStatus; status: string; resolution?: string; resolutionKind?: string }) {
  // `input.status as ...` más abajo era sólo un cast de TypeScript, sin
  // chequeo real: un valor fuera del enum llegaba tal cual a la base.
  if (!VALID_TARGET_STATUSES.has(input.status)) {
    return { ok: false, message: "Estado inválido" }
  }
  if (!VALID_CURRENT_STATUSES.has(input.expectedStatus)) {
    return { ok: false, message: "Estado actual inválido" }
  }
  // Mismo criterio que el resto de esta acción: validar el valor en el servidor
  // y no confiar en el cast. El servicio decide si es obligatorio según la regla.
  if (input.resolutionKind !== undefined && !METER_RESOLUTION_KINDS.includes(input.resolutionKind as MeterResolutionKind)) {
    return { ok: false, message: "Tipo de resolución inválido" }
  }
  const permission = RESOLVING_STATUSES.has(input.status) ? "combustibles:resolve_anomalies" : "combustibles:review_anomalies"
  const guard = await guardPermission(permission, "/combustibles")
  if (guard.error) return guard.error
  try {
    await updateAnomalyCaseStatus(guard.session, input.caseId, input.expectedStatus, input.status as "in_review" | "resolved" | "dismissed" | "reopened", input.resolution, input.resolutionKind as MeterResolutionKind | undefined)
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Estado actualizado" }
  } catch (error) {
    logger.error("[updateAnomalyStatusAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo actualizar"
    return { ok: false, message: msg }
  }
}

export async function assignAnomalyAction(input: { caseId: string; expectedAssigneeId: string | null; assigneeId: string | null }) {
  const guard = await guardPermission("combustibles:review_anomalies", "/combustibles")
  if (guard.error) return guard.error
  try {
    await assignAnomalyCase(guard.session, input.caseId, input.expectedAssigneeId, input.assigneeId)
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Asignado correctamente" }
  } catch (error) {
    logger.error("[assignAnomalyAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo asignar"
    return { ok: false, message: msg }
  }
}

export async function commentAnomalyAction(input: { caseId: string; body: string }) {
  const guard = await guardPermission("combustibles:review_anomalies", "/combustibles")
  if (guard.error) return guard.error
  try {
    await addAnomalyComment(guard.session, input.caseId, input.body)
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Comentario añadido" }
  } catch (error) {
    logger.error("[commentAnomalyAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo comentar"
    return { ok: false, message: msg }
  }
}
