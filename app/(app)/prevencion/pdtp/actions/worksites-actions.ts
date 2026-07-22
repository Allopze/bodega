"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  setPdtpProgramWorksites,
  excludeActivityForWorksite,
  includeActivityForWorksite,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpProgramWorksitesSetSchema,
  pdtpActivityWorksiteExclusionSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function pdtpScopeForSession(session: Parameters<typeof resolveWorksiteScope>[0]) {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.mode === "none" ? [] : scope.ids
}

function fail(e: unknown): ActionState {
  if (e instanceof ZodError) {
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors: e.flatten().fieldErrors as Record<string, string[]> }
  }
  return unexpectedActionError(e, "prevencion/pdtp/worksites-actions")
}

/**
 * Reemplaza la membresía de faenas del programa. Vaciar la lista vuelve al
 * comportamiento histórico (todas las faenas del scope), no borra el
 * programa. Solo editable en `draft`.
 */
export async function setPdtpProgramWorksitesAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpProgramWorksitesSetSchema.parse(input)
    await setPdtpProgramWorksites(parsed.programId, parsed.worksiteIds, guard.session.user.id)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Excluye una actividad completa para una faena (no solo su cantidad planificada). */
export async function excludeActivityForWorksiteAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActivityWorksiteExclusionSchema.parse(input)
    await excludeActivityForWorksite(parsed.activityId, parsed.worksiteId, parsed.reason, guard.session.user.id, pdtpScopeForSession(guard.session))
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** Revierte una exclusión: la faena vuelve a heredar la actividad. */
export async function includeActivityForWorksiteAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  try {
    const parsed = pdtpActivityWorksiteExclusionSchema.parse(input)
    await includeActivityForWorksite(parsed.activityId, parsed.worksiteId, parsed.reason, guard.session.user.id, pdtpScopeForSession(guard.session))
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
