"use server"

import { guardPermission } from "@/lib/auth/can"
import {
  upsertOperationalAssignment,
  type OperationalAssignmentInput,
} from "@/lib/services/operational-assignments"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { safeActionMessage } from "@/lib/action-error"

function sourcePaths(input: Pick<OperationalAssignmentInput, "sourceType" | "sourceId">) {
  if (input.sourceType === "purchase_request") return ["/solicitudes", `/solicitudes/${input.sourceId}`]
  if (input.sourceType === "purchase_order") return ["/compras", `/compras/${input.sourceId}`, "/recepcion", "/recepcion/nueva", "/entregas"]
  // Un ítem puede aparecer en la aprobación, compra o entrega según su etapa.
  return ["/aprobaciones", "/compras", "/entregas"]
}

export async function saveOperationalCommitmentAction(input: OperationalAssignmentInput) {
  const guarded = await guardPermission("operations:assign_work")
  if (guarded.error) return guarded.error
  try {
    await upsertOperationalAssignment(input, guarded.session)
    revalidateOperationalViews(sourcePaths(input))
    return { ok: true as const, message: input.committedDueAt ? "Fecha de compromiso actualizada." : "Pendiente sin fecha de compromiso." }
  } catch (error) {
    logger.warn("[saveOperationalCommitmentAction]", error)
    return { ok: false as const, message: safeActionMessage(error, "No fue posible actualizar la fecha de compromiso.") }
  }
}
