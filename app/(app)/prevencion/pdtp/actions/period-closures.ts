"use server"

/**
 * Acciones del cierre mensual del PDTP por faena.
 *
 * Las tres exigen `prevention:pdtp:close_period` — incluida la distribución.
 * Reenviar un cierre no es "ver": es volver a poner en circulación, como
 * evidencia, una foto firmada del mes. Quien puede hacerlo es quien puede
 * cerrarlo.
 *
 * El cierre y su distribución van en la misma acción cuando la casilla
 * "Distribuir por correo" viene marcada, pero **no** en la misma transacción:
 * si el correo falla, el mes ya quedó cerrado (que es lo importante) y la
 * distribución se reintenta desde la pantalla de cierres con "Reenviar". Al
 * revés —revertir el cierre porque no salió un correo— sería peor.
 */

import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { closePdtpPeriod, reopenPdtpPeriod } from "@/lib/services/pdtp/period-closures"
import { distributePdtpPeriodClosure } from "@/lib/services/pdtp/period-closure-distribution"
import type { ActionState } from "@/lib/validation/prevention"
import {
  closePdtpPeriodSchema,
  distributePdtpPeriodClosureSchema,
  reopenPdtpPeriodSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fail(error: unknown, fallback: string): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  // Las reglas del cierre ("no se puede cerrar un mes que aún no ocurre", "el
  // programa aún no estaba activo en ese mes") son la única pista de por qué no
  // avanza: `safeActionMessage` las deja pasar y sigue ocultando errores de
  // driver y de esquema.
  return { ok: false, message: safeActionMessage(error, fallback) }
}

export async function closePdtpPeriodAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:close_period")
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(closePdtpPeriodSchema, input)
  if (!parsed.ok) return parsed

  const scope = scopeToIds(resolveWorksiteScope(session))
  try {
    const closure = await closePdtpPeriod(parsed.data, session.user.id, scope)
    if (parsed.data.distribute) {
      try {
        await distributePdtpPeriodClosure({ closureId: closure.id }, session.user.id, scope)
      } catch (distributionError) {
        // El mes quedó cerrado: eso es lo que no se puede perder. El aviso se
        // reintenta con "Reenviar" desde la pantalla de cierres.
        logger.error({ err: distributionError, closureId: closure.id }, "[pdtp-cierre] No se pudo distribuir el cierre recién creado.")
        revalidateOperationalViews([REVALIDATE], { worksiteId: parsed.data.worksiteId })
        return { ok: false, message: "El mes quedó cerrado, pero no se pudo enviar el aviso. Usa 'Reenviar' desde la pantalla de cierres." }
      }
    }
    revalidateOperationalViews([REVALIDATE], { worksiteId: parsed.data.worksiteId })
    return { ok: true }
  } catch (e) {
    return fail(e, "No se pudo cerrar el mes. Intenta nuevamente.")
  }
}

export async function reopenPdtpPeriodAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:close_period")
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(reopenPdtpPeriodSchema, input)
  if (!parsed.ok) return parsed

  try {
    await reopenPdtpPeriod(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE])
    return { ok: true }
  } catch (e) {
    return fail(e, "No se pudo reabrir el mes. Intenta nuevamente.")
  }
}

export async function distributePdtpPeriodClosureAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:close_period")
  if (guard.error) return guard.error
  const session = guard.session

  const parsed = parseZ(distributePdtpPeriodClosureSchema, input)
  if (!parsed.ok) return parsed

  try {
    const { recipients } = await distributePdtpPeriodClosure(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidateOperationalViews([REVALIDATE])
    if (recipients === 0) {
      return { ok: false, message: "Nadie en esta faena reúne las condiciones para recibir el cierre." }
    }
    return { ok: true }
  } catch (e) {
    return fail(e, "No se pudo enviar el cierre. Intenta nuevamente.")
  }
}
