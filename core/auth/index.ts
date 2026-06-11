/**
 * core/auth — Authentication, authorization, and RBAC
 *
 * Barrel agregador de toda la capa de autenticación/autorización.
 * Forward shim a lib/auth/. En Fase 3 el contenido se moverá a core/auth/
 * y lib/auth/ pasará a re-exportar desde aquí.
 *
 * Exports disponibles:
 *
 * SESSION / NEXTAUTH
 *   auth          — obtiene la sesión del servidor (RSC, API routes, Server Actions)
 *   handlers      — handler de NextAuth para app/api/auth/[...nextauth]
 *   signIn, signOut
 *
 * GUARDS (Server Actions + RSC)
 *   requirePermission(permission)  — lanza Error si no tiene el permiso
 *   requireAuth()                  — lanza Error si no está autenticado
 *   guardPermission(permission)    — wrapper seguro → { session, error }
 *   guardAuth()                    — wrapper seguro → { session, error }
 *   can(session, permission)       — check booleano
 *   canAny(session, ...perms)
 *   canAll(session, ...perms)
 *   hasRole(session, role)
 *   hasAnyRole(session, ...roles)
 *   canAccessWorksite(session, id)
 *   isGlobalRole(session)
 *   visibleWorksiteIds(session)    — IDs de faenas visibles para el usuario
 *   GLOBAL_ROLES                   — Set<string> de roles sin scoping de faena
 *
 * WORKSITE SCOPE (Drizzle SQL helpers)
 *   worksiteScope(session, column) — genera inArray() predicado para Drizzle
 *   listVisibleWorksites(session)  — lista faenas visibles para el usuario
 *
 * RBAC SNAPSHOT
 *   getUserRbacById(userId)        — snapshot RBAC del usuario (cacheado 60s)
 *   applyRbacToToken(token)        — aplica RBAC al JWT token
 *
 * TYPES
 *   Permission   — union type de todos los permisos del sistema
 *   RoleSlug     — union type de los slugs de roles
 *   UserRbacSnapshot — shape del snapshot RBAC
 *
 * BOOTSTRAP
 *   SYSTEM_ROLES, SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS
 *   ensureSystemRbac()  — upserts roles y permisos base en la BD
 *   getUserCount()
 *   generateInvitationToken()
 *   hashInvitationToken(token)
 *
 * PASSWORD SETUP
 *   isPasswordSetupPending(hashedPassword)
 *   createPendingPasswordMarker()
 *   displayNameFromEmail(email)
 */

// NextAuth session + handlers
export { auth, handlers, signIn, signOut } from "@/lib/auth/auth"

// Guards and boolean checks
export {
  can, canAny, canAll,
  hasRole, hasAnyRole,
  canAccessWorksite, isGlobalRole, visibleWorksiteIds,
  requirePermission, requireAuth,
  guardPermission, guardAuth,
  GLOBAL_ROLES,
} from "@/lib/auth/can"

// Worksite SQL-level scope helpers
export { worksiteScope, listVisibleWorksites } from "@/lib/auth/visibility"

// RBAC snapshot
export { getUserRbacById, applyRbacToToken } from "@/lib/auth/rbac"
export type { UserRbacSnapshot } from "@/lib/auth/rbac"

// Types — NOTE: the `declare module "next-auth"` session augmentation lives in
// lib/auth/types.ts and remains active via the lib/auth/ import chain.
export type { Permission, RoleSlug } from "@/lib/auth/types"

// Bootstrap (seed helpers)
export {
  SYSTEM_ROLES, SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS,
  ensureSystemRbac,
  getUserCount,
  generateInvitationToken,
  hashInvitationToken,
} from "@/lib/auth/bootstrap"

// Password setup helpers
export {
  isPasswordSetupPending,
  createPendingPasswordMarker,
  displayNameFromEmail,
} from "@/lib/auth/password-setup"
