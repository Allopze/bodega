"use server"

import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveEvaluatorRole as resolveEvaluatorRoleCore } from "@/lib/sst/resolve-evaluator-role"
import type { EvaluatorRole } from "@/lib/sst/types"

export const REVALIDATE = "/prevencion"

/** Convert WorksiteScope to string[] | 'all' */
export function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

/** Wraps the shared resolveEvaluatorRole for action-layer consumers. */
export function resolveEvaluatorRole(
  session: { user: { permissions?: string[]; roles?: string[] } },
): EvaluatorRole | undefined {
  return resolveEvaluatorRoleCore({
    permissions: session.user.permissions ?? [],
    roles: (session.user.roles ?? []) as string[],
  })
}
