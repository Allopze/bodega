"use server"

import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { pdtpRegistrationActorFromSession } from "@/lib/auth/pdtp-registration"
import type { PdtpRegistrationActor } from "@/lib/services/pdtp/registration-authority"
import {
  createPdtpObligation,
  reportPdtpObligation,
  type WorksiteScope,
} from "@/lib/services/prevention-pdtp"
import {
  pdtpObligationCancelSchema,
  pdtpObligationCreateSchema,
  pdtpObligationReportSchema,
  type ActionState,
} from "@/lib/validation/prevention"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { requestPdtpObligationCancellation } from "@/lib/services/pdtp/review-requests"

function scopeFromSession(session: NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>): WorksiteScope {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
}

/**
 * El permiso es un parámetro y no una constante del wrapper: reportar el
 * cumplimiento es trabajo de terreno (`execute`), pero anular el compromiso es
 * gestión y tiene su propio permiso.
 */
async function run(
  permission: "prevention:pdtp:execute" | "prevention:pdtp:obligation:cancel",
  operation: (context: { userId: string; scope: WorksiteScope; actor: PdtpRegistrationActor }) => Promise<unknown>,
): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    await operation({ userId: guard.session!.user.id, scope: scopeFromSession(guard.session!), actor: pdtpRegistrationActorFromSession(guard.session!) })
    revalidateOperationalViews(["/prevencion/pdtp/obligaciones", "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    }
    // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
    // para el operador")` y son la única pista de por qué la operación no
    // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
    // de driver y de esquema.
    return actionErrorResult(error, "No se pudo completar la acción. Intenta nuevamente.")
  }
}

export async function createPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:execute", ({ userId, scope }) => {
    // NEW-01: desde la acción sólo nacen obligaciones manuales; ver el
    // esquema. La fecha del hecho es la del servidor.
    const parsed = pdtpObligationCreateSchema.parse(input)
    return createPdtpObligation({
      ...parsed,
      origin: "manual",
      sourceType: parsed.sourceType ?? undefined,
      sourceId: parsed.sourceId ?? undefined,
      sourceMetadata: {},
      userId,
      scope,
    })
  })
}

export async function reportPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:execute", ({ userId, scope, actor }) => {
    const parsed = pdtpObligationReportSchema.parse(input)
    return reportPdtpObligation({
      ...parsed,
      evidenceText: parsed.evidenceText ?? undefined,
      evidenceUrl: parsed.evidenceUrl ?? undefined,
      userId,
      scope,
      // PREV-I03: reporta quien responde por la actividad, o Prevención.
      actor,
    })
  })
}

/**
 * PRV-05 (auditoría 2026-09-28): cancelar saca la obligación del indicador de
 * plazos, así que desde la pantalla ya no se cancela directo: se pide, y otra
 * persona la aprueba en Aprobaciones.
 */
export async function cancelPdtpObligationAction(input: unknown): Promise<ActionState> {
  return run("prevention:pdtp:obligation:cancel", ({ userId, scope }) => {
    const parsed = pdtpObligationCancelSchema.parse(input)
    return requestPdtpObligationCancellation({ targetId: parsed.obligationId, reason: parsed.reason }, userId, scope)
  })
}
