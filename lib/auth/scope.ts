import type { Session } from "next-auth"
import { eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm"

/**
 * Roles with global worksite visibility (no faena scoping).
 * Kept as a static fallback; prefer session.isGlobal which is derived
 * from the roles.is_global DB column at login time.
 */
export const GLOBAL_ROLES = new Set([
  "administrador",
  "jefa_chome",
  "secretaria",
  "prevencionista",
  "jefe_mantencion",
  "gerente_legal_rrhh",
  "subgerente_operaciones",
  "tecnico_ti",
])

/**
 * Check if a user has global worksite visibility.
 * Prefers the session.isGlobal flag (derived from DB at login),
 * falls back to the static GLOBAL_ROLES set for backward compatibility.
 */
export function isGlobalRole(session: Session | null): boolean {
  if (!session?.user) return false
  if (typeof session.user.isGlobal === "boolean") return session.user.isGlobal
  // Fallback for sessions created before isGlobal was added
  return session.user.roles?.some((role) => GLOBAL_ROLES.has(role)) ?? false
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

/**
 * ARQ-11: forma que los servicios (fuera de Drizzle/SQL) esperan el alcance
 * de faena — `"all"` o la lista concreta de ids. Estaba duplicada idéntica
 * en flota/compras/entregas/bodega/recepcion `actions.ts`.
 */
export function serviceWorksiteScope(session: Session | null): string[] | "all" {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.ids
}

/**
 * Predicado de faena para una consulta: alcance del rol, opcionalmente acotado a
 * una sola faena.
 *
 * `worksiteId` **se intersecta** con el alcance del rol, nunca lo reemplaza: una
 * faena fuera del permiso devuelve `false` (cero filas), no las filas de esa
 * faena. Es el techo de permisos del alcance global del dashboard.
 *
 * `undefined` significa "sin cláusula" y sólo lo devuelve un rol global sin
 * faena elegida.
 */
export function worksiteScopeSql(session: Session | null, column: AnyColumn, worksiteId?: string): SQL | undefined {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return sql`false`
  if (worksiteId) {
    if (scope.mode === "some" && !scope.ids.includes(worksiteId)) return sql`false`
    return eq(column, worksiteId)
  }
  if (scope.mode === "all") return undefined
  return inArray(column, scope.ids)
}
