"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import {
  resolveTraceabilityIntegrityCase,
  scanTraceabilityIntegrity,
} from "@/lib/services/traceability-integrity-cases"

export interface TraceabilityIntegrityActionState {
  ok: boolean
  message: string
}

const resolveIntegrityCaseSchema = z.object({
  caseId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/),
  action: z.enum(["acknowledge", "compensating_movement"]),
  reason: z.string().trim().min(10).max(2000),
  compensatingMovementId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable(),
}).superRefine((value, ctx) => {
  if (value.action === "compensating_movement" && !value.compensatingMovementId) {
    ctx.addIssue({ code: "custom", path: ["compensatingMovementId"], message: "Selecciona el movimiento compensatorio" })
  }
  if (value.action === "acknowledge" && value.compensatingMovementId) {
    ctx.addIssue({ code: "custom", path: ["compensatingMovementId"], message: "No corresponde adjuntar un movimiento" })
  }
})

export async function scanTraceabilityIntegrityAction(
  _previous: TraceabilityIntegrityActionState,
  _formData: FormData,
): Promise<TraceabilityIntegrityActionState> {
  let session
  try { session = await requirePermission("traceability:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para revisar excepciones de trazabilidad" } }

  try {
    const { findings, recordedCount } = await scanTraceabilityIntegrity(session)
    revalidatePath("/trazabilidad")
    return {
      ok: true,
      message: recordedCount > 0
        ? `Se registraron ${recordedCount} excepciones de ${findings.length} detectadas`
        : findings.length > 0
          ? "Las excepciones detectadas ya estaban registradas"
          : "No se detectaron excepciones de trazabilidad",
    }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible revisar la integridad de trazabilidad") }
  }
}

export async function resolveTraceabilityIntegrityCaseAction(
  _previous: TraceabilityIntegrityActionState,
  formData: FormData,
): Promise<TraceabilityIntegrityActionState> {
  let session
  try { session = await requirePermission("traceability:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para regularizar excepciones" } }

  const parsed = resolveIntegrityCaseSchema.safeParse({
    caseId: formData.get("caseId"),
    action: formData.get("action"),
    reason: formData.get("reason"),
    compensatingMovementId: formData.get("compensatingMovementId") || null,
  })
  if (!parsed.success) return { ok: false, message: "Revisa el motivo y el movimiento compensatorio" }

  try {
    await resolveTraceabilityIntegrityCase({
      ...parsed.data,
      userId: session.user.id,
      userEmail: session.user.email,
      session,
    })
    revalidatePath("/trazabilidad")
    return { ok: true, message: "La excepción quedó regularizada con evidencia append-only" }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible regularizar la excepción") }
  }
}
