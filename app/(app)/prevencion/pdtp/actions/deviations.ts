"use server"

/**
 * Acciones de los desvíos por celda del PDTP.
 *
 * El permiso depende del tipo, porque el efecto depende del tipo:
 *
 * - `not_performed` lo declara quien ejecuta (`prevention:pdtp:execute`) o
 *   quien sólo deja constancias (`prevention:constancias:execute`): es el
 *   responsable diciendo por qué no alcanzó a hacer su trabajo. No cambia lo
 *   planificado ni el denominador del cumplimiento.
 * - `not_applicable` cambia lo planificado (saca la celda del cálculo), así
 *   que exige el mismo permiso que fijar metas por faena
 *   (`prevention:pdtp:override:manage`) — PERO Constancias (G17, task 9/M2.1)
 *   necesita poder declararla también: es la misma celda que ya puede marcar
 *   "se hizo", y sin esto un responsable que sólo ve Constancias no podría
 *   decir "no aplica" sin que además le dieran el permiso de metas por faena.
 *   Se acepta entonces `prevention:constancias:execute` como alternativa,
 *   pero acotada por mecanismo (`assertPdtpActivityMechanism`, igual que
 *   `markPdtpExecutionAction`): sin la acotación, ese permiso serviría para
 *   sacar del denominador cualquier celda de la planilla con sólo construir
 *   el POST a mano.
 * - `reprogrammed` sigue exigiendo únicamente `prevention:pdtp:override:manage`,
 *   sin excepción: mueve el planificado a otro período, una decisión de
 *   planificación distinta a dejar constancia de un hecho, y el flujo de
 *   Constancias no la necesita.
 *
 * El tipo del retiro NO se lee del formulario sino de la fila
 * (`getPdtpDeviationKindAndActivity`): dejar que el cliente declare el tipo
 * es dejar que elija su propio permiso.
 */

import { ZodError } from "zod"
import { can, guardAnyPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  assertPdtpActivityMechanism,
  getPdtpDeviationKindAndActivity,
  recordPdtpDeviation,
  withdrawPdtpDeviation,
} from "@/lib/services/prevention-pdtp"
import type { Permission } from "@/modules/permissions"
import type { ActionState } from "@/lib/validation/prevention"
import { pdtpDeviationSchema, pdtpDeviationWithdrawSchema } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"
const CONSTANCIAS_REVALIDATE = "/prevencion/constancias"

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
  // Las reglas de `recordPdtpDeviation` ("ya hay una ejecución en esta celda",
  // "el destino cae fuera del horizonte"…) son la única pista que tiene el
  // operador de por qué no avanza: `safeActionMessage` las deja pasar y sigue
  // ocultando errores de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo registrar el desvío. Intenta nuevamente.") }
}

/**
 * El permiso "fuerte" de cada tipo — el que NO necesita acotarse por
 * mecanismo porque ya implica poder tocar cualquier actividad de la
 * planilla. `reprogrammed` sólo tiene este.
 */
function strongPermissionForKind(kind: string): Permission {
  return kind === "not_applicable" || kind === "reprogrammed"
    ? "prevention:pdtp:override:manage"
    : "prevention:pdtp:execute"
}

/**
 * Permisos aceptados para EXIGIR (no otorgar) por tipo de desvío: un cliente
 * que mienta el `kind` pide un permiso más estricto o falla la validación de
 * Zod (el enum sólo acepta los tres tipos reales). `not_performed` y
 * `not_applicable` aceptan además `prevention:constancias:execute`, acotado
 * por mecanismo más abajo; `reprogrammed` no tiene alternativa.
 */
function permissionsForKind(kind: string): Permission[] {
  if (kind === "reprogrammed") return ["prevention:pdtp:override:manage"]
  return [strongPermissionForKind(kind), "prevention:constancias:execute"]
}

/** Un campo de destino vacío es "no hay destino", no un 0 que Zod rechazaría. */
function optionalNumberField(value: FormDataEntryValue | null): unknown {
  if (value === null) return undefined
  const text = String(value).trim()
  return text === "" ? undefined : text
}

export async function recordPdtpDeviationAction(formData: FormData): Promise<ActionState> {
  const kind = String(formData.get("kind") ?? "")
  const guard = await guardAnyPermission(permissionsForKind(kind))
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(pdtpDeviationSchema, {
    activityId: formData.get("activityId"),
    worksiteId: formData.get("worksiteId"),
    year: formData.get("year"),
    month: formData.get("month"),
    week: formData.get("week"),
    kind: formData.get("kind"),
    reason: formData.get("reason") ?? "",
    targetMonth: optionalNumberField(formData.get("targetMonth")),
    targetWeek: optionalNumberField(formData.get("targetWeek")),
  })
  if (!parsed.ok) return parsed

  try {
    // Sin el permiso fuerte, sólo puede haber entrado por Constancias: el
    // server action no confía en que la UI ya filtró la actividad (mismo
    // criterio que `markPdtpExecutionAction`).
    if (!can(session, strongPermissionForKind(parsed.data.kind))) {
      await assertPdtpActivityMechanism(parsed.data.activityId, "constancia")
    }
    await recordPdtpDeviation(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, CONSTANCIAS_REVALIDATE], { worksiteId: parsed.data.worksiteId })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function withdrawPdtpDeviationAction(formData: FormData): Promise<ActionState> {
  const deviationId = String(formData.get("deviationId") ?? "")
  const deviation = deviationId ? await getPdtpDeviationKindAndActivity(deviationId) : null
  if (!deviation) return { ok: false, message: "Desvío PDTP no encontrado." }

  // Retirar deshace el efecto, así que exige el mismo permiso que declararlo:
  // volver a meter una celda al denominador es tan sensible como sacarla.
  const guard = await guardAnyPermission(permissionsForKind(deviation.kind))
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(pdtpDeviationWithdrawSchema, {
    deviationId,
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.ok) return parsed

  try {
    if (!can(session, strongPermissionForKind(deviation.kind))) {
      await assertPdtpActivityMechanism(deviation.activityId, "constancia")
    }
    await withdrawPdtpDeviation(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE, CONSTANCIAS_REVALIDATE])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
