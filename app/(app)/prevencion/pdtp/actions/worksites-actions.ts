"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import {
  setPdtpProgramWorksites,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpProgramWorksitesSetSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

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
    const worksiteScope = resolveWorksiteScope(guard.session)
    await setPdtpProgramWorksites(
      parsed.programId,
      parsed.worksiteIds,
      guard.session.user.id,
      worksiteScope.mode === "all" ? "all" : worksiteScope.ids,
    )
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
