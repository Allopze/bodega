"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import { decideFlaggedLoad } from "@/lib/combustibles/control/review"

/**
 * Aprobar o rechazar una carga marcada. La autorización (permiso + alcance de
 * faena) se verifica aquí y en el servicio; la nota es obligatoria y queda en
 * la auditoría como motivo.
 */

type DecisionInput = { loadId: string; note: string }
type DecisionResult = { ok: boolean; message?: string }

async function decide(input: DecisionInput, decision: "approve" | "reject"): Promise<DecisionResult> {
  const guard = await guardPermission("combustibles:approve_flagged", "/combustibles/control/revision")
  if (guard.error) return guard.error
  if (!input || typeof input.loadId !== "string" || input.loadId.trim() === "" || typeof input.note !== "string") {
    return { ok: false, message: "Solicitud incompleta: falta la carga o el motivo" }
  }
  try {
    const result = await decideFlaggedLoad(guard.session, { loadId: input.loadId, decision, note: input.note })
    if (!result.ok) return result
    revalidatePath("/combustibles/control", "layout")
    return { ok: true, message: decision === "approve" ? "Carga aprobada" : "Carga rechazada" }
  } catch (error) {
    logger.error("[decideFlaggedLoad]", error)
    return { ok: false, message: safeActionMessage(error, "No se pudo registrar la decisión. Reintenta.") }
  }
}

export async function approveFlaggedLoadAction(input: DecisionInput): Promise<DecisionResult> {
  return decide(input, "approve")
}

export async function rejectFlaggedLoadAction(input: DecisionInput): Promise<DecisionResult> {
  return decide(input, "reject")
}
