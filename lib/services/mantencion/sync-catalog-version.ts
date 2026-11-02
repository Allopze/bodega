import { createHash } from "node:crypto"
import { sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantBrands, mantDrivers, mantEquipmentProfiles, mantOils, mantRecordObservations,
  mantRecords, mantSchedules, mantScheduleVersions, mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders, mantWorkshops,
  mantWorkshopUpdates, mantWorkTypes, rolePermissions, userPermissions, userRoles, users, worksites, worksiteUsers,
} from "@/db/schema"
import { OT_PERMISSIONS } from "@/lib/mantencion/work-order-states"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "./access"

/**
 * Versión (ETag) del catálogo de la app: una huella barata de «¿cambió algo que
 * este mecánico vería?». Una sola consulta de agregados (máximo de las marcas de
 * tiempo y conteo de cada tabla que alimenta el catálogo), más lo propio de la
 * persona (sus faenas y permisos) y la fecha de hoy, porque los días detenido y
 * el «sin actualizar» del taller cambian con el calendario aunque no cambie
 * ninguna fila.
 *
 * Es una heurística de caché: un falso «cambió» sólo cuesta una descarga de
 * más; un falso «no cambió» no puede ocurrir mientras cada tabla de abajo
 * actualice su marca de tiempo al editarse (el conteo cubre los borrados).
 */

/** Súbelo cuando cambie la FORMA de la respuesta del catálogo: invalida las cachés de los teléfonos. */
export const CATALOG_FORMAT = 3

type Source = readonly [AnyPgTable, readonly AnyPgColumn[]]

const SOURCES: readonly Source[] = [
  [mantRecords, [mantRecords.receivedAt, mantRecords.updatedAt]],
  [mantWorkshopUpdates, [mantWorkshopUpdates.receivedAt]],
  // Órdenes de trabajo (2026-11): lo que el mecánico ve de sus OT. Formato 3: sin las «por asignar» (ya no se toman).
  [mantWorkOrders, [mantWorkOrders.updatedAt]],
  [mantWorkOrderItems, [mantWorkOrderItems.markedAt, mantWorkOrderItems.createdAt]],
  [mantWorkOrderEvents, [mantWorkOrderEvents.createdAt]],
  [mantRecordObservations, [mantRecordObservations.createdAt, mantRecordObservations.respondedAt]],
  [mantEquipmentProfiles, [mantEquipmentProfiles.updatedAt]],
  [fuelVehicles, [fuelVehicles.updatedAt]],
  [fuelEquipmentTypes, [fuelEquipmentTypes.updatedAt]],
  [worksites, [worksites.updatedAt]],
  [mantBrands, [mantBrands.updatedAt]],
  [mantWorkshops, [mantWorkshops.updatedAt]],
  [mantWorkTypes, [mantWorkTypes.updatedAt]],
  [mantOils, [mantOils.updatedAt]],
  [mantDrivers, [mantDrivers.updatedAt]],
  [mantSchedules, [mantSchedules.updatedAt]],
  [mantScheduleVersions, [mantScheduleVersions.createdAt]],
  // La lista de «otros mecánicos» depende de quién tiene la app y en qué faena.
  [users, [users.updatedAt]],
  [worksiteUsers, []],
  [userRoles, []],
  [rolePermissions, []],
  [userPermissions, []],
]

function aggregate([table, columns]: Source): SQL {
  const stamps = columns.map((column) => sql`coalesce(max(${column})::text, '')`)
  return sql`(select ${sql.join([...stamps, sql`count(*)::text`], sql` || '|' || `)} from ${table})`
}

function driverRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: T[] }).rows) ?? []
}

export type CatalogScope = "mias" | "todos"

export async function catalogVersion(viewer: MantViewer, scope: CatalogScope): Promise<string> {
  const result = await db.execute(sql`select ${sql.join(SOURCES.map(aggregate), sql` || '#' || `)} as fingerprint`)
  const fingerprint = driverRows<{ fingerprint: string }>(result)[0]?.fingerprint ?? ""
  // Apagar el submódulo de OT cambia lo que el catálogo trae sin tocar ninguna fila.
  const otEnabled = viewer.permissions.includes(OT_PERMISSIONS.execute) && await isRouteOperational("/mantencion/ot")
  const own = [
    CATALOG_FORMAT,
    otEnabled ? "ot" : "sin-ot",
    scope,
    viewer.userId,
    viewer.isGlobal ? "global" : "faena",
    [...viewer.worksiteIds].sort().join(","),
    todayInChile(),
  ].join("#")
  return createHash("sha256").update(`${fingerprint}##${own}`).digest("hex").slice(0, 32)
}

/** `If-None-Match` puede traer varios valores, comillas y el prefijo débil `W/` (un proxy que comprime lo agrega). */
export function etagMatches(ifNoneMatch: string | null, version: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch.split(",").some((candidate) => candidate.trim().replace(/^W\//, "").replace(/^"|"$/g, "") === version)
}
