"use server"

import { revalidatePath } from "next/cache"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { ZodError } from "zod"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { pdtpRegistrationActorFromSession } from "@/lib/auth/pdtp-registration"
import { assertWorksiteAccess } from "@/lib/services/pdtp/helpers"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpScheduledInstanceOutcomeReviewSchema,
  pdtpScheduledInstanceOutcomeSchema,
  pdtpScheduledInstanceOutcomeWithdrawSchema,
  pdtpScheduledInstanceStartSchema,
} from "@/lib/validation/prevention"
import {
  getPdtpScheduledInstanceStartContext,
  recordPdtpScheduledInstanceOutcome,
  startPdtpScheduledInstance,
} from "@/lib/services/pdtp/scheduled-execution"
import {
  reviewPdtpScheduledInstanceOutcome,
  withdrawPdtpScheduledInstanceOutcomeRequest,
} from "@/lib/services/pdtp/scheduled-outcome-review"
import type { WorksiteScope } from "@/lib/services/pdtp/helpers"

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return actionErrorResult(error, "No se pudo abrir la actividad programada.")
}

/** Reserva una instancia y entrega el enlace al formulario nativo del conector. */
export async function startPdtpScheduledInstanceAction(input: unknown): Promise<ActionState> {
  const guard = await guardAuth()
  if (guard.error) return guard.error
  try {
    const parsed = pdtpScheduledInstanceStartSchema.parse(input)
    const context = await getPdtpScheduledInstanceStartContext(parsed.instanceId)
    if (!context) throw new Error("Instancia programada no encontrada.")
    const scope = resolveWorksiteScope(guard.session)
    assertWorksiteAccess(context.instance.worksiteId, scope.mode === "all" ? "all" : scope.mode === "none" ? [] : scope.ids)
    if (!guard.session.user.permissions.includes(context.connector.executePermission)) {
      return { ok: false, message: "No tienes permiso para ejecutar esta actividad en el submódulo seleccionado." }
    }
    const started = await startPdtpScheduledInstance({
      instanceId: parsed.instanceId,
      userId: guard.session.user.id,
      connectorKey: context.connector.key,
      instrumentId: parsed.instrumentId,
    })
    revalidatePath("/pendientes")
    revalidatePath(`/prevencion/pdtp/${started.instance.programId}`)
    return {
      ok: true,
      data: {
        href: started.startHref,
        instanceId: started.instance.id,
        connectorKey: started.connector.key,
        startIdempotencyKey: started.startIdempotencyKey,
      },
    }
  } catch (error) {
    return fail(error)
  }
}

function scopeOf(session: Parameters<typeof resolveWorksiteScope>[0]): WorksiteScope {
  const resolved = resolveWorksiteScope(session)
  return resolved.mode === "all" ? "all" : resolved.mode === "none" ? [] : resolved.ids
}

/**
 * Registra envío, "no aplica" o cancelación de una ocurrencia (PREV-I08-c).
 * Completar no se ofrece: la ocurrencia se cumple al aprobar su ejecución en
 * el PDTP (D19). Se autentica antes de validar, como la acción de inicio.
 *
 * PREV-C07 (0334): "no aplica" y cancelar quedan en revisión; la respuesta lo
 * dice (`pendingReview`) para que la pantalla no anuncie un cambio que todavía
 * no ocurrió.
 */
export async function recordPdtpScheduledInstanceOutcomeAction(input: unknown): Promise<ActionState> {
  const guard = await guardAuth()
  if (guard.error) return guard.error
  try {
    const parsed = pdtpScheduledInstanceOutcomeSchema.parse(input)
    const context = await getPdtpScheduledInstanceStartContext(parsed.instanceId)
    if (!context) throw new Error("Instancia programada no encontrada.")
    const permission = parsed.action === "not_applicable"
      ? "prevention:pdtp:override:manage"
      : parsed.action === "cancel"
        ? "prevention:pdtp:obligation:cancel"
        : context.connector.executePermission
    if (!guard.session.user.permissions.includes(permission as Permission)) {
      return { ok: false, message: "No tienes permiso para registrar este resultado." }
    }
    const resolvedScope = resolveWorksiteScope(guard.session)
    const scope = resolvedScope.mode === "all" ? "all" as const : resolvedScope.mode === "none" ? [] : resolvedScope.ids
    assertWorksiteAccess(context.instance.worksiteId, scope)
    const updated = await recordPdtpScheduledInstanceOutcome({
      instanceId: parsed.instanceId,
      action: parsed.action,
      userId: guard.session.user.id,
      evidenceRef: parsed.evidenceRef,
      reason: parsed.reason,
      scope,
      actor: pdtpRegistrationActorFromSession(guard.session),
    })
    revalidatePath("/pendientes")
    revalidatePath(`/prevencion/pdtp/${updated.programId}`)
    if (updated.outcomeRequestId) {
      revalidatePath("/prevencion/pdtp/aprobaciones")
      return {
        ok: true,
        message: "Quedó en revisión: el cumplimiento no cambia hasta que otra persona con permiso de aprobación lo apruebe.",
        data: { instanceId: updated.id, status: updated.status, outcomeRequestId: updated.outcomeRequestId, pendingReview: true },
      }
    }
    return { ok: true, data: { instanceId: updated.id, status: updated.status } }
  } catch (error) {
    return fail(error)
  }
}

/**
 * PREV-C07 (0334): aprueba o rechaza el "no aplica" o la cancelación de una
 * ocurrencia. Mismo permiso que revisar el N/A de una celda
 * (`prevention:pdtp:approve`); la segregación la impone el servicio.
 */
export async function reviewPdtpScheduledInstanceOutcomeAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const parsed = pdtpScheduledInstanceOutcomeReviewSchema.safeParse({
    requestId: formData.get("requestId") ?? "",
    decision: formData.get("decision") ?? "",
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.success) return fail(parsed.error)
  try {
    await reviewPdtpScheduledInstanceOutcome(parsed.data, guard.session.user.id, scopeOf(guard.session))
    revalidatePath("/pendientes")
    revalidatePath("/prevencion/pdtp", "layout")
    return { ok: true }
  } catch (error) {
    return actionErrorResult(error, "No se pudo revisar la solicitud. Intenta nuevamente.")
  }
}

/** Quien pidió el "no aplica" o la cancelación la retira mientras sigue en revisión. */
export async function withdrawPdtpScheduledInstanceOutcomeAction(formData: FormData): Promise<ActionState> {
  const guard = await guardAuth()
  if (guard.error) return guard.error
  const parsed = pdtpScheduledInstanceOutcomeWithdrawSchema.safeParse({
    requestId: formData.get("requestId") ?? "",
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.success) return fail(parsed.error)
  try {
    await withdrawPdtpScheduledInstanceOutcomeRequest(parsed.data, guard.session.user.id, scopeOf(guard.session))
    revalidatePath("/pendientes")
    revalidatePath("/prevencion/pdtp", "layout")
    return { ok: true }
  } catch (error) {
    return actionErrorResult(error, "No se pudo retirar la solicitud. Intenta nuevamente.")
  }
}
