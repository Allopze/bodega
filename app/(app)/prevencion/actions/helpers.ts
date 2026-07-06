"use server"

import type { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"

export const REVALIDATE = "/prevencion"

/** Convert WorksiteScope to string[] | 'all' */
export function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

/**
 * Determina el EvaluatorRole del usuario autenticado basándose en sus permisos.
 * - conductor_lider: tiene sst:evaluate_acompanamiento pero NO sst:create
 * - admin_contrato:  tiene sst:create y su rol en DB es rol-admin-contrato
 * - prevencionista_faena: tiene sst:create (fallback)
 */
export function resolveEvaluatorRole(
  session: Awaited<ReturnType<typeof guardAuth>>["session"] extends infer S
    ? S extends null
      ? never
      : NonNullable<S>
    : never,
): import("@/lib/sst/types").EvaluatorRole | undefined {
  const perms = session.user.permissions ?? []
  const roleNames: string[] = session.user.roles ?? []

  if (perms.includes("sst:evaluate_acompanamiento") && !perms.includes("sst:create")) {
    return "conductor_lider"
  }
  if (perms.includes("sst:create")) {
    if (roleNames.includes("admin_contrato")) return "admin_contrato"
    return "prevencionista_faena"
  }
  return undefined
}
