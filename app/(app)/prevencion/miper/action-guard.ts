/**
 * Frontera común de las Server Functions de la MIPER: permiso, alcance y actor
 * de la sesión, traducción de errores de dominio y revalidación. NO lleva
 * "use server": lo importan `actions.ts` y los archivos de acciones propios de
 * cada vista, y desde un archivo "use server" `guarded` quedaría publicado como
 * endpoint invocable.
 */
import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import { PreventionEvidenceError } from "@/lib/services/prevention-evidence-upload"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import type { MiperAccess } from "@/lib/services/miper/shared"
import type { ActionState } from "@/lib/validation/prevention"

export const MIPER_BASE = "/prevencion/miper"
export type MiperSession = NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>

export function accessFrom(session: MiperSession): MiperAccess {
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

export function matrixIdOf(input: unknown) {
  return typeof input === "object" && input && "matrixId" in input ? String((input as { matrixId: unknown }).matrixId) : null
}

/**
 * El error de dominio viaja con su mensaje (le dice a la persona qué hacer);
 * Zod, con sus campos; el resto se loguea y responde genérico para no filtrar
 * detalles de driver o SQL.
 */
export function fail(error: unknown): ActionState {
  if (error instanceof RiskLegalDomainError) return { ok: false, message: error.message }
  // La subida de evidencia valida el tipo real y el tamaño del archivo: su
  // mensaje es lo único que le dice a la persona qué corregir.
  if (error instanceof PreventionEvidenceError) return { ok: false, message: error.message }
  if (error instanceof ZodError) return actionErrorResult(error, "Revisa los campos marcados.")
  return unexpectedActionError(error, "prevencion/miper/actions")
}

export async function guarded<T>(permission: Permission, input: unknown, operation: (access: MiperAccess) => Promise<T>, options: { revalidate?: boolean; data?: (result: T) => Record<string, unknown>; success?: string | ((result: T) => string); after?: (session: MiperSession) => Promise<void> } = {}): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const result = await operation(accessFrom(guard.session))
    if (options.revalidate !== false) {
      revalidatePath(MIPER_BASE)
      const matrixId = matrixIdOf(input)
      if (matrixId) revalidatePath(`${MIPER_BASE}/${matrixId}`)
    }
    if (options.after) await options.after(guard.session)
    const data = options.data?.(result)
    const success = typeof options.success === "function" ? options.success(result) : options.success
    // El mensaje de éxito es de la acción y no genérico: con `feedback: "toast"`,
    // el hook notifica `result.message`, así que sin esto guardar antecedentes,
    // enviar a revisión y sellar una versión se anunciaban igual.
    return { ok: true, ...(success ? { message: success } : {}), ...(data ? { data } : {}) }
  } catch (error) {
    return fail(error)
  }
}

export function stringFieldOf(input: unknown, key: string): string | null {
  if (typeof input !== "object" || !input || !(key in input)) return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : null
}
