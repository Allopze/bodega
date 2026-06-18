import type { Session } from "next-auth"
import { inArray, sql, type AnyColumn, type SQL } from "drizzle-orm"

/**
 * Roles with global worksite visibility (no faena scoping).
 */
export const GLOBAL_ROLES = new Set([
  "administrador",
  "jefa_chome",
  "secretaria",
  "prevencionista",
  "jefe_mantencion",
])

export function isGlobalRole(session: Session | null): boolean {
  if (!session?.user?.roles) return false
  return session.user.roles.some((role) => GLOBAL_ROLES.has(role))
}

/**
 * Check if a user has access to a specific worksite.
 * Operational leadership sees all worksites. Faena requesters are scoped.
 */
export function canAccessWorksite(session: Session | null, worksiteId: string): boolean {
  if (!session?.user) return false
  if (isGlobalRole(session)) return true
  return session.user.worksiteIds.includes(worksiteId)
}

/**
 * Returns the worksite ids the session is allowed to see. An empty array
 * for a faena requester means "no access" (caller should treat the result
 * as a no-rows predicate). An empty array for a global role means
 * "no filter" (caller should skip the WHERE).
 */
export function visibleWorksiteIds(session: Session | null): string[] {
  if (!session?.user) return []
  if (isGlobalRole(session)) return []
  return session.user.worksiteIds ?? []
}

export type WorksiteScope =
  | { mode: "all"; ids: [] }
  | { mode: "some"; ids: string[] }
  | { mode: "none"; ids: [] }

export function resolveWorksiteScope(session: Session | null): WorksiteScope {
  if (isGlobalRole(session)) return { mode: "all", ids: [] }
  const ids = visibleWorksiteIds(session)
  return ids.length > 0 ? { mode: "some", ids } : { mode: "none", ids: [] }
}

export function worksiteScopeSql(session: Session | null, column: AnyColumn): SQL | undefined {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return undefined
  if (scope.mode === "none") return sql`1 = 0`
  return inArray(column, scope.ids)
}
