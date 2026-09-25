import { headers } from "next/headers"
import type { Session } from "next-auth"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { PreventionDocumentDomainError } from "@/lib/services/prevention-documents/errors"
import type { ActionState } from "@/lib/validation/masters"

export const REVALIDATE = "/prevencion/documentacion"

/**
 * El error de dominio viaja con su mensaje: le dice a la persona qué hacer
 * (recargar, pedir otra firma, completar la evidencia). El resto pasa por
 * `unexpectedActionError`, que lo loguea y responde genérico para no filtrar
 * detalles de driver o SQL. Antes todo caía en el genérico.
 */
export function fail<T extends object = Record<string, never>>(error: unknown): ActionState & { data?: T } {
  if (error instanceof PreventionDocumentDomainError) return { ok: false, message: error.message }
  return unexpectedActionError(error, "prevencion/documentacion/actions")
}

export async function clientCtx(session: Session) {
  const h = await headers()
  return {
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  }
}
