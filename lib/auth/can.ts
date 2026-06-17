import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import { auth } from "./auth"
import { logger } from "@/lib/logger"
export {
  canAccessWorksite,
  GLOBAL_ROLES,
  isGlobalRole,
  visibleWorksiteIds,
} from "./scope"

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
 * Server-side: require permission. Returns session on success.
 * For Server Components (redirects), use `ensurePermission()`.
 * For Server Actions, catch the error and return `{ ok: false }`.
 */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  if (!can(session, permission)) throw new Error(`Forbidden: missing permission ${permission}`)
  return session
}

/**
 * Server-side: require authenticated session.
 * For Server Components (redirects), use `ensureAuth()`.
 */
export async function requireAuth(): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  return session
}

/**
 * Safe wrapper for Server Actions. Returns an ActionState instead of throwing.
 * Usage: const { session, error } = await guardPermission("requests:create")
 *         if (error) return error
 */
export async function guardPermission(permission: Permission): Promise<
  | { session: Session; error: null }
  | { session: null; error: { ok: false; message: string } }
> {
  try {
    const session = await requirePermission(permission)
    return { session, error: null }
  } catch (err) {
    // No exponer la taxonomía interna de permisos al cliente; loguear el detalle.
    logger.warn("[guardPermission]", permission, err)
    return { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
  }
}

/**
 * Safe wrapper for Server Actions. Returns an ActionState instead of throwing.
 */
export async function guardAuth(): Promise<
  | { session: Session; error: null }
  | { session: null; error: { ok: false; message: string } }
> {
  try {
    const session = await requireAuth()
    return { session, error: null }
  } catch (err) {
    logger.warn("[guardAuth]", err)
    return { session: null, error: { ok: false, message: "Debes iniciar sesión para continuar" } }
  }
}
