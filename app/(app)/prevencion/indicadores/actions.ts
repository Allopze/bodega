"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { parseZ } from "@/lib/actions/parse-z"
import {
  approveSafetyIndicatorDenominator,
  upsertSafetyIndicatorMonth,
  upsertSafetyIndicatorDenominator,
  closeSafetyIndicatorPeriod,
} from "@/lib/services/prevention-indicadores"
import {
  approveSafetyIndicatorDenominatorSchema,
  closeSafetyIndicatorPeriodSchema,
  safetyIndicatorDenominatorSchema,
  safetyIndicatorMonthSchema,
} from "@/lib/validation/prevention-module/safety-indicators"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/indicadores"

/**
 * `/prevencion/indicadores/${year}/${month}` no existe: el módulo tiene una
 * sola `page.tsx` que resuelve el período por query param. Revalidar esa ruta
 * fantasma no fallaba —`revalidatePath` no verifica que exista— pero tampoco
 * hacía nada, y sugería una ruta dinámica que nadie escribió. Se dejó sólo la
 * raíz, que es la que sirve la página real.
 */
function refresh() {
  revalidatePath(REVALIDATE)
}

export async function saveSafetyIndicatorMonthAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const parsed = parseZ(safetyIndicatorMonthSchema, input)
  if (!parsed.ok) return parsed
  try {
    await upsertSafetyIndicatorMonth(parsed.data, session.user.id, resolveWorksiteScope(session), session.user.permissions.includes("prevention:indicadores:close"))
    refresh()
    return { ok: true }
  } catch (e) {
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function closeSafetyIndicatorPeriodAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:close")
  if (guard.error) return guard.error
  const parsed = parseZ(closeSafetyIndicatorPeriodSchema, input)
  if (!parsed.ok) return parsed
  try {
    await closeSafetyIndicatorPeriod(parsed.data, guard.session.user.id, resolveWorksiteScope(guard.session))
    refresh()
    return { ok: true }
  } catch (e) {
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function saveSafetyIndicatorDenominatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:manage")
  if (guard.error) return guard.error
  const parsed = parseZ(safetyIndicatorDenominatorSchema, input)
  if (!parsed.ok) return parsed
  try {
    await upsertSafetyIndicatorDenominator(parsed.data, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function approveSafetyIndicatorDenominatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:close")
  if (guard.error) return guard.error
  const parsed = parseZ(approveSafetyIndicatorDenominatorSchema, input)
  if (!parsed.ok) return parsed
  try {
    await approveSafetyIndicatorDenominator(parsed.data, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}
