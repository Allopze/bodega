"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  approveSafetyIndicatorDenominator,
  upsertSafetyIndicatorMonth,
  upsertSafetyIndicatorDenominator,
  closeSafetyIndicatorPeriod,
} from "@/lib/services/prevention-indicadores"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/indicadores"

export async function saveSafetyIndicatorMonthAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:manage")
  if (guard.error) return guard.error
  const session = guard.session
  try {
    await upsertSafetyIndicatorMonth(input, session.user.id, resolveWorksiteScope(session), session.user.permissions.includes("prevention:indicadores:close"))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
    }
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function closeSafetyIndicatorPeriodAction(input: { worksiteId: string; year: number; month: number; reason: string }): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:close")
  if (guard.error) return guard.error
  try {
    await closeSafetyIndicatorPeriod(input, guard.session.user.id, resolveWorksiteScope(guard.session))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function saveSafetyIndicatorDenominatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:manage")
  if (guard.error) return guard.error
  try {
    await upsertSafetyIndicatorDenominator(input, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
    }
    return unexpectedActionError(e, "prevencion/indicadores/actions")
  }
}

export async function approveSafetyIndicatorDenominatorAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:indicadores:close")
  if (guard.error) return guard.error
  try {
    await approveSafetyIndicatorDenominator(input, {
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
