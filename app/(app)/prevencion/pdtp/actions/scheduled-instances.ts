"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardAuth } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { assertWorksiteAccess } from "@/lib/services/pdtp/helpers"
import { safeActionMessage } from "@/lib/action-error"
import type { ActionState } from "@/lib/validation/prevention"
import { pdtpScheduledInstanceOutcomeSchema, pdtpScheduledInstanceStartSchema } from "@/lib/validation/prevention"
import {
  getPdtpScheduledInstanceStartContext,
  recordPdtpScheduledInstanceOutcome,
  startPdtpScheduledInstance,
} from "@/lib/services/pdtp/scheduled-execution"

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return { ok: false, message: safeActionMessage(error, "No se pudo abrir la actividad programada.") }
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

/** Registra envío, cumplimiento, no aplica o cancelación de una ocurrencia. */
export async function recordPdtpScheduledInstanceOutcomeAction(input: unknown): Promise<ActionState> {
  try {
    const parsed = pdtpScheduledInstanceOutcomeSchema.parse(input)
    const guard = await guardAuth()
    if (guard.error) return guard.error
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
    assertWorksiteAccess(context.instance.worksiteId, (() => {
      const scope = resolveWorksiteScope(guard.session)
      return scope.mode === "all" ? "all" : scope.mode === "none" ? [] : scope.ids
    })())
    const updated = await recordPdtpScheduledInstanceOutcome({
      instanceId: parsed.instanceId,
      action: parsed.action,
      userId: guard.session.user.id,
      evidenceRef: parsed.evidenceRef,
      reason: parsed.reason,
      sourceMetadata: parsed.sourceMetadata,
    })
    revalidatePath("/pendientes")
    revalidatePath(`/prevencion/pdtp/${updated.programId}`)
    return { ok: true, data: { instanceId: updated.id, status: updated.status } }
  } catch (error) {
    return fail(error)
  }
}
