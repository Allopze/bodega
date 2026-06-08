import type { Session } from "next-auth"
import type { Permission } from "./types"
import { auth } from "./auth"

/**
 * Check if a session user has a given permission.
 * Used in both Server Components and API route handlers.
 */
export function can(session: Session | null, permission: Permission): boolean {
  if (!session?.user?.permissions) return false
  return session.user.permissions.includes(permission)
}

/**
 * Check if a session user has any of the given permissions.
 */
export function canAny(session: Session | null, ...perms: Permission[]): boolean {
  if (!session?.user?.permissions) return false
  return perms.some((p) => session.user.permissions.includes(p))
}

/**
 * Check if a session user has all of the given permissions.
 */
export function canAll(session: Session | null, ...perms: Permission[]): boolean {
  if (!session?.user?.permissions) return false
  return perms.every((p) => session.user.permissions.includes(p))
}

/**
 * Check if a user has a given role.
 */
export function hasRole(session: Session | null, role: string): boolean {
  if (!session?.user?.roles) return false
  return session.user.roles.includes(role)
}

/**
 * Check if a user has any of the given roles.
 */
export function hasAnyRole(session: Session | null, ...roles: string[]): boolean {
  if (!session?.user?.roles) return false
  return roles.some((r) => session.user.roles.includes(r))
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
 * Roles with global worksite visibility (no faena scoping).
 * Mirrors the rule inside canAccessWorksite — exposed so reports and
 * dashboards can branch on it without re-implementing the role list.
 */
export const GLOBAL_ROLES = new Set([
  "administrador",
  "jefa_chome",
  "secretaria",
  "prevencionista",
])

export function isGlobalRole(session: Session | null): boolean {
  if (!session?.user?.roles) return false
  return session.user.roles.some((role) => GLOBAL_ROLES.has(role))
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

/**
 * Server-side: require permission or throw redirect.
 * Use in Server Components and Server Actions.
 */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  if (!can(session, permission)) throw new Error(`Forbidden: missing permission ${permission}`)
  return session
}

/**
 * Server-side: require authenticated session.
 */
export async function requireAuth(): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  return session
}
