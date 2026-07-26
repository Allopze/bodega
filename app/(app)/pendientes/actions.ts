"use server"

import { guardPermission } from "@/lib/auth/can"
import {
  getOperationalAssignmentCandidates,
  upsertOperationalAssignment,
  type OperationalAssignmentInput,
} from "@/lib/services/operational-assignments"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

function sourcePaths(input: Pick<OperationalAssignmentInput, "sourceType" | "sourceId">) {
  if (input.sourceType === "purchase_request") return ["/solicitudes", `/solicitudes/${input.sourceId}`]
  if (input.sourceType === "purchase_order") return ["/compras", `/compras/${input.sourceId}`, "/recepcion", "/recepcion/nueva", "/entregas"]
  // Un ítem puede aparecer en la aprobación, compra o entrega según su etapa.
  return ["/aprobaciones", "/compras", "/entregas"]
}

export async function listOperationalAssignmentCandidatesAction(input: Pick<OperationalAssignmentInput, "sourceType" | "sourceId" | "actionKey">) {
  const guarded = await guardPermission("operations:assign_work")
  if (guarded.error) return { ok: false as const, message: guarded.error.message, candidates: [] as Array<{ id: string; name: string }> }
  try {
    const candidates = await getOperationalAssignmentCandidates(input, guarded.session)
    return { ok: true as const, candidates }
  } catch (error) {
    logger.warn("[listOperationalAssignmentCandidatesAction]", error)
    return { ok: false as const, message: "No fue posible cargar personas elegibles para esta etapa.", candidates: [] as Array<{ id: string; name: string }> }
  }
}

export async function saveOperationalAssignmentAction(input: OperationalAssignmentInput) {
  const guarded = await guardPermission("operations:assign_work")
  if (guarded.error) return guarded.error
  try {
    await upsertOperationalAssignment(input, guarded.session)
    revalidateOperationalViews(sourcePaths(input))
    return { ok: true as const, message: input.assigneeUserId ? "Responsable actualizado." : "Pendiente sin responsable complementario." }
  } catch (error) {
    logger.warn("[saveOperationalAssignmentAction]", error)
    return { ok: false as const, message: error instanceof Error ? error.message : "No fue posible actualizar la asignación." }
  }
}
