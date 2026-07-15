"use server"

import { revalidatePath } from "next/cache"
import { isNetworkError } from "@/lib/network-error"
import { guardPermission } from "@/lib/auth/can"
import { updateAnomalyCaseStatus, assignAnomalyCase, addAnomalyComment } from "@/lib/combustibles/anomaly-cases"
import { logger } from "@/lib/logger"

/** in_review/reopened son parte de la revisión; resolved/dismissed cierran el caso y requieren el permiso de resolución. */
const RESOLVING_STATUSES = new Set(["resolved", "dismissed"])

export async function updateAnomalyStatusAction(input: { caseId: string; status: string; resolution?: string }) {
  const permission = RESOLVING_STATUSES.has(input.status) ? "combustibles:resolve_anomalies" : "combustibles:review_anomalies"
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    await updateAnomalyCaseStatus(input.caseId, input.status as "in_review" | "resolved" | "dismissed" | "reopened", guard.session.user.id, input.resolution)
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Estado actualizado" }
  } catch (error) {
    logger.error("[updateAnomalyStatusAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo actualizar"
    return { ok: false, message: msg }
  }
}

export async function assignAnomalyAction(input: { caseId: string; assigneeId: string | null }) {
  const guard = await guardPermission("combustibles:review_anomalies")
  if (guard.error) return guard.error
  try {
    await assignAnomalyCase(input.caseId, input.assigneeId)
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Asignado correctamente" }
  } catch (error) {
    logger.error("[assignAnomalyAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo asignar"
    return { ok: false, message: msg }
  }
}

export async function commentAnomalyAction(input: { caseId: string; body: string }) {
  const guard = await guardPermission("combustibles:review_anomalies")
  if (guard.error) return guard.error
  if (!input.body.trim()) return { ok: false, message: "El comentario no puede estar vacío" }
  try {
    await addAnomalyComment(input.caseId, guard.session.user.id, input.body.trim())
    revalidatePath("/combustibles/anomalias")
    return { ok: true, message: "Comentario añadido" }
  } catch (error) {
    logger.error("[commentAnomalyAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo comentar"
    return { ok: false, message: msg }
  }
}
