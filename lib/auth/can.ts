import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import { auth } from "./auth"
import { logger } from "@/lib/logger"
import { headers } from "next/headers"
import {
  assertPermissionModuleEnabled,
  assertRouteModuleEnabled,
  ModuleDisabledError,
  ModuleToggleUnavailableError,
} from "@/lib/services/module-toggles"
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
export async function requirePermission(permission: Permission, operationPathname?: string): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  if (!can(session, permission)) throw new Error(`Forbidden: missing permission ${permission}`)
  // Proxy fija esta cabecera upstream; no se toma del navegador. Puede faltar
  // (invocación interna sin contexto HTTP, o una ruta que el matcher no cubre),
  // y por eso el guard NO se condiciona a ella: el permiso ya identifica su
  // módulo, y el pathname sólo afina el submódulo cuando está disponible.
  let pathname: string | null = null
  try { pathname = (await headers()).get("x-chome-pathname") }
  catch { pathname = null }
  await assertPermissionModuleEnabled(permission, pathname ?? undefined, operationPathname)
  return session
}

/**
 * Server-side: require authenticated session.
 * For Server Components (redirects), use `ensureAuth()`.
 */
export async function requireAuth(): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  // Las superficies que se autorizan con `requireAuth()` + `can()` a mano
  // (impresiones, descargas) no pasan por `requirePermission`, así que sin esto
  // eran el único camino autenticado sin control de módulo.
  let pathname: string | null = null
  try { pathname = (await headers()).get("x-chome-pathname") }
  catch { pathname = null }
  if (pathname) await assertRouteModuleEnabled(pathname)
  return session
}

/**
 * Safe wrapper for Server Actions. Returns an ActionState instead of throwing.
 * Usage: const { session, error } = await guardPermission("requests:create")
 *         if (error) return error
 */
export async function guardPermission(permission: Permission, operationPathname?: string): Promise<
  | { session: Session; error: null }
  | { session: null; error: { ok: false; message: string } }
> {
  try {
    const session = await requirePermission(permission, operationPathname)
    return { session, error: null }
  } catch (err) {
    // No exponer la taxonomía interna de permisos al cliente; loguear el detalle.
    logger.warn("[guardPermission]", permission, err)
    if (err instanceof ModuleDisabledError) {
      return { session: null, error: { ok: false, message: "El módulo está inactivo temporalmente" } }
    }
    if (err instanceof ModuleToggleUnavailableError) {
      return { session: null, error: { ok: false, message: "No se pudo verificar el estado del módulo. Reintenta." } }
    }
    return { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
  }
}

/**
 * Igual que `requirePermission`, pero autoriza con cualquiera de varios
 * permisos — para una acción de servicio compartida por dos módulos que se
 * conceden por separado (p. ej. `pdtp:execute` y `constancias:execute` sobre
 * `markPdtpExecution`), donde ninguno de los dos debe ser prerrequisito del
 * otro.
 */
export async function requireAnyPermission(permissions: Permission[], operationPathname?: string): Promise<Session> {
  const session = await auth()
  if (!session) throw new Error("Unauthorized: not authenticated")
  const granted = permissions.find((permission) => can(session, permission))
  if (!granted) throw new Error(`Forbidden: missing permission ${permissions.join(" or ")}`)
  let pathname: string | null = null
  try { pathname = (await headers()).get("x-chome-pathname") }
  catch { pathname = null }
  await assertPermissionModuleEnabled(granted, pathname ?? undefined, operationPathname)
  return session
}

/** Safe wrapper for Server Actions, análogo a `guardPermission` pero con `requireAnyPermission`. */
export async function guardAnyPermission(permissions: Permission[], operationPathname?: string): Promise<
  | { session: Session; error: null }
  | { session: null; error: { ok: false; message: string } }
> {
  try {
    const session = await requireAnyPermission(permissions, operationPathname)
    return { session, error: null }
  } catch (err) {
    logger.warn("[guardAnyPermission]", permissions, err)
    if (err instanceof ModuleDisabledError) {
      return { session: null, error: { ok: false, message: "El módulo está inactivo temporalmente" } }
    }
    if (err instanceof ModuleToggleUnavailableError) {
      return { session: null, error: { ok: false, message: "No se pudo verificar el estado del módulo. Reintenta." } }
    }
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
