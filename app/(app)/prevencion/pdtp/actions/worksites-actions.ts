"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
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
  // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
  // para el operador")` y son la única pista de por qué la operación no
  // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
  // de driver y de esquema.
  return { ok: false, message: safeActionMessage(e, "No se pudo completar la acción. Intenta nuevamente.") }
}

/**
 * Reemplaza la membresía de faenas del programa. Vaciar la lista declara el
 * alcance corporativo de forma explícita, no borra el programa. Solo editable
 * en `draft`.
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
      parsed.worksiteIds.length === 0,
    )
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
