"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import {
  resolveTraceabilityIntegrityCase,
  scanTraceabilityIntegrity,
} from "@/lib/services/traceability-integrity-cases"
import {
  acknowledgeOperationalIntegrityCase,
  scanOperationalIntegrity,
  verifyOperationalIntegrityCase,
} from "@/lib/services/operational-integrity"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

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
  try { session = await requirePermission("warehouse:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para revisar excepciones de trazabilidad" } }

  try {
    const { findings, recordedCount } = await scanTraceabilityIntegrity(session)
    revalidatePath("/bodega/trazabilidad")
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
  try { session = await requirePermission("warehouse:reconcile_integrity") }
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
    revalidatePath("/bodega/trazabilidad")
    return { ok: true, message: "La excepción quedó regularizada con evidencia append-only" }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible regularizar la excepción") }
  }
}

/**
 * Ledger de integridad operacional.
 *
 * Las tres acciones exigen `warehouse:reconcile_integrity` en cada llamada: un
 * Server Action es alcanzable por su id sin pasar por el render de la página.
 *
 * Un caso ajeno a la faena y uno inexistente comparten respuesta a propósito.
 * El servicio ya los enmascara por igual (`Caso no encontrado`); distinguirlos
 * aquí convertiría el ledger en un oráculo de qué faenas tienen problemas.
 */
const DOMAINS = ["stock", "receiving", "purchasing"] as const

const scanIntegritySchema = z.object({
  domains: z.array(z.enum(DOMAINS)).nonempty(),
})

const caseIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/)

const acknowledgeIntegritySchema = z.object({
  caseId: caseIdSchema,
  reason: z.string().trim().min(10).max(2000),
})

export async function scanOperationalIntegrityAction(
  _previous: TraceabilityIntegrityActionState,
  formData: FormData,
): Promise<TraceabilityIntegrityActionState> {
  let session
  try { session = await requirePermission("warehouse:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para revisar la integridad operacional" } }

  const requested = formData.getAll("domains").filter((value): value is string => typeof value === "string")
  const parsed = scanIntegritySchema.safeParse({ domains: requested.length > 0 ? requested : [...DOMAINS] })
  if (!parsed.success) return { ok: false, message: "Selecciona un dominio válido para revisar" }

  try {
    const { found, recorded } = await scanOperationalIntegrity(session, [...parsed.data.domains])
    revalidateOperationalViews(["/bodega/trazabilidad"])
    return {
      ok: true,
      message: recorded > 0
        ? `Se registraron ${recorded} observaciones nuevas de ${found} detectadas`
        : found > 0
          ? "Los casos detectados ya estaban registrados con la misma evidencia"
          : "No se detectaron problemas de integridad en tu alcance",
    }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible revisar la integridad operacional") }
  }
}

export async function acknowledgeOperationalIntegrityCaseAction(
  _previous: TraceabilityIntegrityActionState,
  formData: FormData,
): Promise<TraceabilityIntegrityActionState> {
  let session
  try { session = await requirePermission("warehouse:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para reconocer casos de integridad" } }

  const parsed = acknowledgeIntegritySchema.safeParse({
    caseId: formData.get("caseId"),
    reason: formData.get("reason"),
  })
  if (!parsed.success) return { ok: false, message: "El motivo debe tener entre 10 y 2000 caracteres" }

  try {
    await acknowledgeOperationalIntegrityCase(session, parsed.data.caseId, parsed.data.reason)
    revalidateOperationalViews(["/bodega/trazabilidad"])
    return { ok: true, message: "El caso quedó reconocido con su motivo en la evidencia" }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible reconocer el caso") }
  }
}

export async function verifyOperationalIntegrityCaseAction(
  _previous: TraceabilityIntegrityActionState,
  formData: FormData,
): Promise<TraceabilityIntegrityActionState> {
  let session
  try { session = await requirePermission("warehouse:reconcile_integrity") }
  catch { return { ok: false, message: "No tienes permisos para verificar casos de integridad" } }

  const parsed = caseIdSchema.safeParse(formData.get("caseId"))
  if (!parsed.success) return { ok: false, message: "Caso no encontrado" }

  try {
    // Cerrar es potestad del detector, no de quien aprieta el botón: si la
    // evidencia sigue ahí, la acción informa que el caso continúa abierto.
    const { resolved } = await verifyOperationalIntegrityCase(session, parsed.data)
    revalidateOperationalViews(["/bodega/trazabilidad"])
    return resolved
      ? { ok: true, message: "El detector ya no encuentra el problema: el caso quedó resuelto" }
      : { ok: true, message: "El problema sigue presente: el caso continúa abierto con la evidencia actualizada" }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible verificar el caso") }
  }
}
