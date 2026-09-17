"use server"

/**
 * Acciones de los desvíos por celda del PDTP.
 *
 * El permiso depende del tipo, porque el efecto depende del tipo:
 *
 * - `not_performed` lo declara quien ejecuta (`prevention:pdtp:execute`): es
 *   el responsable diciendo por qué no alcanzó a hacer su trabajo. No cambia
 *   lo planificado ni el denominador del cumplimiento.
 * - `not_applicable` y `reprogrammed` cambian lo planificado (sacan la celda
 *   del cálculo o la mueven), así que exigen el mismo permiso que fijar metas
 *   por faena (`prevention:pdtp:override:manage`). Si los pudiera declarar
 *   quien ejecuta, el propio responsable podría borrar del denominador lo que
 *   no hizo — que es exactamente lo que el indicador existe para impedir.
 *
 * El tipo del retiro NO se lee del formulario sino de la fila
 * (`getPdtpDeviationKind`): dejar que el cliente declare el tipo es dejar que
 * elija su propio permiso.
 */

import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import {
  getPdtpDeviationKind,
  recordPdtpDeviation,
  withdrawPdtpDeviation,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import { pdtpDeviationSchema, pdtpDeviationWithdrawSchema } from "@/lib/validation/prevention"

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
  // Las reglas de `recordPdtpDeviation` ("ya hay una ejecución en esta celda",
  // "el destino cae fuera del horizonte"…) son la única pista que tiene el
  // operador de por qué no avanza: `safeActionMessage` las deja pasar y sigue
  // ocultando errores de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo registrar el desvío. Intenta nuevamente.") }
}

/** Permiso exigido por cada tipo de desvío. */
function permissionForKind(kind: string): "prevention:pdtp:execute" | "prevention:pdtp:override:manage" {
  return kind === "not_performed" ? "prevention:pdtp:execute" : "prevention:pdtp:override:manage"
}

/** Un campo de destino vacío es "no hay destino", no un 0 que Zod rechazaría. */
function optionalNumberField(value: FormDataEntryValue | null): unknown {
  if (value === null) return undefined
  const text = String(value).trim()
  return text === "" ? undefined : text
}

export async function recordPdtpDeviationAction(formData: FormData): Promise<ActionState> {
  // El `kind` del formulario elige el permiso a EXIGIR, no a otorgar: un
  // cliente que mienta pide un permiso más estricto o falla la validación de
  // Zod (el enum sólo acepta los tres tipos reales).
  const guard = await guardPermission(permissionForKind(String(formData.get("kind") ?? "")))
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
    await recordPdtpDeviation(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE], { worksiteId: parsed.data.worksiteId })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function withdrawPdtpDeviationAction(formData: FormData): Promise<ActionState> {
  const deviationId = String(formData.get("deviationId") ?? "")
  const kind = deviationId ? await getPdtpDeviationKind(deviationId) : null
  if (!kind) return { ok: false, message: "Desvío PDTP no encontrado." }

  // Retirar deshace el efecto, así que exige el mismo permiso que declararlo:
  // volver a meter una celda al denominador es tan sensible como sacarla.
  const guard = await guardPermission(permissionForKind(kind))
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(pdtpDeviationWithdrawSchema, {
    deviationId,
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.ok) return parsed

  try {
    await withdrawPdtpDeviation(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE])
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
