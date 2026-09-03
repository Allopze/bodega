"use server"

import { ZodError } from "zod"
import { can, guardAnyPermission, guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import {
  approvePdtpExecution,
  assertPdtpActivityMechanism,
  rejectPdtpExecution,
  markPdtpExecution,
} from "@/lib/services/prevention-pdtp"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { parseZ } from "@/lib/actions/parse-z"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpExecutionSchema,
  pdtpExecutionApprovalSchema,
  pdtpExecutionRejectionSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
  // para el operador")` y son la única pista de por qué la operación no
  // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
  // de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
}

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  // `PdtpExecutionForm` es la misma pieza en la planilla y en Constancias
  // (G17): un permiso no debe ser prerrequisito del otro, así que se acepta
  // cualquiera de los dos y se acota el alcance por mecanismo más abajo.
  const guard = await guardAnyPermission(["prevention:pdtp:execute", "prevention:constancias:execute"])
  if (guard.error) return guard.error
  const session = guard.session

  const evidenceUrl = formData.get("evidenceUrl")
  const parsed = parseZ(pdtpExecutionSchema, {
    activityId: formData.get("activityId"),
    worksiteId: formData.get("worksiteId"),
    year: formData.get("year"),
    month: formData.get("month"),
    week: formData.get("week"),
    executedQuantity: formData.get("executedQuantity"),
    evidenceText: formData.get("evidenceText") ?? "",
    evidenceUrl: evidenceUrl ?? "",
    evidencePhotos: [],
  })
  if (!parsed.ok) return parsed

  try {
    // Sin `prevention:pdtp:execute`, sólo puede haber entrado por Constancias:
    // el server action no confía en que la UI ya filtró la actividad.
    if (!can(session, "prevention:pdtp:execute")) {
      await assertPdtpActivityMechanism(parsed.data.activityId, "constancia")
    }
    await markPdtpExecution(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, "/prevencion/constancias"])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<ActionState> {
  return markPdtpExecutionAction(formData)
}

export async function approvePdtpExecutionAction(executionId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionApprovalSchema.parse({ executionId })
    await approvePdtpExecution(parsed.executionId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function rejectPdtpExecutionAction(
  executionId: string,
  reason: string,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:approve")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    const parsed = pdtpExecutionRejectionSchema.parse({ executionId, reason })
    await rejectPdtpExecution(parsed.executionId, session.user.id, parsed.reason, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, "/prevencion/pdtp/aprobaciones"])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
