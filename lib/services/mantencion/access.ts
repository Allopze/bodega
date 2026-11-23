import { eq, inArray, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { fuelVehicles, mantRecords } from "@/db/schema"
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

/**
 * «La hoja de vida sigue al equipo» (decisión 2026-11-22): el equipo está HOY en una de estas
 * faenas (`fuel_vehicles.worksite_id`). `vehicleIdColumn` es la columna del equipo de la fila
 * que se filtra (`mant_records.vehicle_id`, `mant_historical_records.vehicle_id`).
 *
 * Subconsulta correlacionada con alias propio, para no chocar con un `fuel_vehicles` que la
 * consulta externa ya una. Sin faenas no hay nada que comparar: `false`.
 */
export function equipmentCurrentlyInWorksites(vehicleIdColumn: AnyPgColumn, worksiteIds: readonly string[]): SQL {
  if (worksiteIds.length === 0) return sql`false`
  const ids = sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)
  return sql`exists (select 1 from ${fuelVehicles} as cur_veh where cur_veh.id = ${vehicleIdColumn} and cur_veh.worksite_id in (${ids}))`
}

/**
 * Predicado SQL sobre `mant_records` para LEER. Sin ningún permiso de lectura: `false`.
 *
 * Un usuario con alcance por faena ve un registro si su faena —o la faena ACTUAL del equipo— está
 * en su alcance: la hoja de vida sigue al equipo trasladado. Ver no es actuar: observar, revisar,
 * anular y corregir siguen exigiendo la faena del registro (`canActOnRecord`).
 */
export function recordVisibilitySql(visibility: RecordVisibility): SQL {
  if (visibility.kind === "all") return sql`true`
  const parts: SQL[] = []
  if (visibility.worksiteIds.length) {
    parts.push(inArray(mantRecords.worksiteId, visibility.worksiteIds))
    parts.push(equipmentCurrentlyInWorksites(mantRecords.vehicleId, visibility.worksiteIds))
  }
  if (visibility.ownUserId) {
    parts.push(eq(mantRecords.registeredBy, visibility.ownUserId))
    parts.push(eq(mantRecords.executorUserId, visibility.ownUserId))
  }
  return parts.length ? or(...parts)! : sql`false`
}

/**
 * Lo mismo que `recordVisibilitySql`, pero SIN seguir al equipo: sólo la faena DEL REGISTRO (y lo propio).
 * Es la base de las CIFRAS (Panel, Indicadores): el trabajo cuenta donde se hizo, aunque el equipo se haya
 * trasladado después (decisión 2026-11-22: la hoja de vida sigue al equipo; las cifras, a la faena del trabajo).
 */
export function recordWorksiteVisibilitySql(visibility: RecordVisibility): SQL {
  if (visibility.kind === "all") return sql`true`
  const parts: SQL[] = []
  if (visibility.worksiteIds.length) parts.push(inArray(mantRecords.worksiteId, visibility.worksiteIds))
  if (visibility.ownUserId) {
    parts.push(eq(mantRecords.registeredBy, visibility.ownUserId))
    parts.push(eq(mantRecords.executorUserId, visibility.ownUserId))
  }
  return parts.length ? or(...parts)! : sql`false`
}

/**
 * ¿Puede LEER el registro? `vehicleWorksiteId` es la faena actual de su equipo
 * (`fuel_vehicles.worksite_id`); quien llama debe pasarla, porque omitirla da la regla vieja
 * (sólo la faena del registro) y la hoja de vida de un equipo trasladado quedaría recortada.
 */
export function canSeeRecord(
  visibility: RecordVisibility,
  record: { worksiteId: string; registeredBy: string; executorUserId: string | null; vehicleWorksiteId?: string | null },
): boolean {
  if (canActOnRecord(visibility, record)) return true
  return !!record.vehicleWorksiteId && visibility.kind === "scoped" && visibility.worksiteIds.includes(record.vehicleWorksiteId)
}

/**
 * ¿Puede ACTUAR sobre el registro (observar, revisar, anular, corregir, cerrar su taller)? Es la
 * regla estricta: la faena DEL REGISTRO o lo propio. Ver la historia de un equipo trasladado no da
 * derecho a revisar el trabajo de otra faena.
 */
export function canActOnRecord(
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

/**
 * Alcance de quien administra dispositivos: lo usan la LISTA y la revocación.
 * La página llamaba al servicio sin actor y listaba las credenciales de todas
 * las faenas (auditoría 2026-11-11).
 */
export function deviceManagerActor(viewer: MantViewer) {
  return {
    userId: viewer.userId,
    isGlobal: viewer.isGlobal,
    viewAll: hasMantPermission(viewer, "mant:records:view_all"),
    worksiteIds: viewer.worksiteIds,
  }
}
