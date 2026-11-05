import { eq, inArray, or, sql, type SQL } from "drizzle-orm"
import type { Session } from "next-auth"
import { mantRecords } from "@/db/schema"
import type { MantWorksiteScope } from "./fleet"

/**
 * Alcance de lectura del módulo (§6), resuelto SIEMPRE en el servidor:
 *
 * - `mant:records:view_all`      → todas las faenas;
 * - `mant:records:view_worksite` → las faenas asignadas (`worksite_users`); un
 *   rol global las ve todas;
 * - `mant:records:view_own`      → los registros que registró o ejecutó.
 *
 * Se suman: un supervisor ve su faena y además lo propio de otra. La
 * navegación sólo refleja esto; ocultar un botón no es control de acceso.
 */
export interface MantViewer {
  userId: string
  email: string | null
  permissions: readonly string[]
  worksiteIds: readonly string[]
  isGlobal: boolean
}

export function viewerFromSession(session: Session): MantViewer {
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    permissions: session.user.permissions ?? [],
    worksiteIds: session.user.worksiteIds ?? [],
    isGlobal: !!session.user.isGlobal,
  }
}

export function hasMantPermission(viewer: MantViewer, permission: string): boolean {
  return viewer.permissions.includes(permission)
}

export type RecordVisibility =
  | { kind: "all" }
  | { kind: "scoped"; worksiteIds: string[]; ownUserId: string | null }

export function recordVisibility(viewer: MantViewer): RecordVisibility {
  if (hasMantPermission(viewer, "mant:records:view_all")) return { kind: "all" }
  if (hasMantPermission(viewer, "mant:records:view_worksite") && viewer.isGlobal) return { kind: "all" }
  const worksiteIds = hasMantPermission(viewer, "mant:records:view_worksite") ? [...viewer.worksiteIds] : []
  const ownUserId = hasMantPermission(viewer, "mant:records:view_own") ? viewer.userId : null
  return { kind: "scoped", worksiteIds, ownUserId }
}

/** Predicado SQL sobre `mant_records`. Sin ningún permiso de lectura: `false`. */
export function recordVisibilitySql(visibility: RecordVisibility): SQL {
  if (visibility.kind === "all") return sql`true`
  const parts: SQL[] = []
  if (visibility.worksiteIds.length) parts.push(inArray(mantRecords.worksiteId, visibility.worksiteIds))
  if (visibility.ownUserId) {
    parts.push(eq(mantRecords.registeredBy, visibility.ownUserId))
    parts.push(eq(mantRecords.executorUserId, visibility.ownUserId))
  }
  return parts.length ? or(...parts)! : sql`false`
}

export function canSeeRecord(
  visibility: RecordVisibility,
  record: { worksiteId: string; registeredBy: string; executorUserId: string | null },
): boolean {
  if (visibility.kind === "all") return true
  if (visibility.worksiteIds.includes(record.worksiteId)) return true
  return !!visibility.ownUserId
    && (record.registeredBy === visibility.ownUserId || record.executorUserId === visibility.ownUserId)
}

/**
 * Faenas cuyos EQUIPOS puede ver y administrar (panel, lista de equipos,
 * exportaciones y escrituras de equipos). Lo propio no abre equipos: un mecánico
 * ve sus registros, no la flota ajena.
 *
 * `mant:equipment:manage` NO abre todas las faenas: administrar equipos de una
 * faena que no se ve sería un IDOR listo para aparecer en cuanto el permiso se
 * delegue a un encargado sin `view_all`. Un rol global sí ve todas.
 */
export function equipmentScope(viewer: MantViewer): MantWorksiteScope {
  if (hasMantPermission(viewer, "mant:records:view_all")) return "all"
  if (hasMantPermission(viewer, "mant:records:view_worksite")) return viewer.isGlobal ? "all" : [...viewer.worksiteIds]
  if (hasMantPermission(viewer, "mant:equipment:manage")) return viewer.isGlobal ? "all" : [...viewer.worksiteIds]
  return []
}

/** ¿La faena cae dentro del alcance de equipos? Un arreglo vacío no incluye ninguna. */
export function isWorksiteInScope(scope: MantWorksiteScope, worksiteId: string | null | undefined): boolean {
  return scope === "all" || (!!worksiteId && scope.includes(worksiteId))
}

/**
 * Alcance de escritura de equipos de un actor. Las acciones lo calculan con
 * `equipmentScope()` y lo pasan en `MantActor.scope`; `undefined` significa «sin
 * filtro» y sólo lo usan rutas cuyo permiso ya es global (pautas, importador
 * histórico) y las pruebas.
 */
export function actorEquipmentScope(actor: { scope?: MantWorksiteScope }): MantWorksiteScope {
  return actor.scope ?? "all"
}

/** Mensaje único cuando una escritura de equipos cae fuera de las faenas del actor. */
export const EQUIPMENT_OUT_OF_SCOPE = "Ese equipo es de una faena que no administras."

/** Observar: jefatura en todo su alcance; supervisión sólo en sus faenas (§6). */
export function canObserveRecord(viewer: MantViewer, record: { worksiteId: string }): boolean {
  if (!hasMantPermission(viewer, "mant:records:observe")) return false
  if (hasMantPermission(viewer, "mant:records:view_all") || viewer.isGlobal) return true
  return viewer.worksiteIds.includes(record.worksiteId)
}
