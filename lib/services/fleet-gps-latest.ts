import type { Session } from "next-auth"
import { and, inArray, isNotNull, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsLatestPositions } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import {
  mergeLatestGpsByVehicle,
  type LatestGpsRow,
  type MergedVehicleGps,
} from "@/lib/integrations/fleet-gps/merge-latest"

/**
 * Lectura común de la última telemetría por equipo. OnWay y Wialon escriben en
 * la misma tabla con `provider` distinto; esta capa entrega las filas crudas y
 * el merge por vehículo para que Monitoreo, Flota y el Panel operacional no
 * vuelvan a resolver el problema cada uno por su lado.
 */

export interface LatestGpsQueryOptions {
  vehicleIds?: readonly string[]
  worksiteId?: string
}

async function selectLatestGps(where: SQL | undefined): Promise<LatestGpsRow[]> {
  const rows = await db.select({
    id: fleetGpsLatestPositions.id,
    provider: fleetGpsLatestPositions.provider,
    externalDeviceId: fleetGpsLatestPositions.externalDeviceId,
    vehicleId: fleetGpsLatestPositions.vehicleId,
    worksiteId: fleetGpsLatestPositions.worksiteId,
    sourcePlate: fleetGpsLatestPositions.sourcePlate,
    normalizedPlate: fleetGpsLatestPositions.normalizedPlate,
    latitude: fleetGpsLatestPositions.latitude,
    longitude: fleetGpsLatestPositions.longitude,
    speedKph: fleetGpsLatestPositions.speedKph,
    headingDegrees: fleetGpsLatestPositions.headingDegrees,
    ignition: fleetGpsLatestPositions.ignition,
    sourceStatus: fleetGpsLatestPositions.sourceStatus,
    gpsReportedAt: fleetGpsLatestPositions.gpsReportedAt,
    gprsReportedAt: fleetGpsLatestPositions.gprsReportedAt,
    gpsStatus: fleetGpsLatestPositions.gpsStatus,
    gprsStatus: fleetGpsLatestPositions.gprsStatus,
    movementState: fleetGpsLatestPositions.movementState,
    odometer: fleetGpsLatestPositions.odometer,
    hourMeter: fleetGpsLatestPositions.hourMeter,
    internalBatteryLevel: fleetGpsLatestPositions.internalBatteryLevel,
    externalPowerVolts: fleetGpsLatestPositions.externalPowerVolts,
    engineRpm: fleetGpsLatestPositions.engineRpm,
    coolantTemperature: fleetGpsLatestPositions.coolantTemperature,
    fuelLevel: fleetGpsLatestPositions.fuelLevel,
    temperature1: fleetGpsLatestPositions.temperature1,
    humidity1: fleetGpsLatestPositions.humidity1,
    driverMappingId: fleetGpsLatestPositions.driverMappingId,
    observedAt: fleetGpsLatestPositions.observedAt,
  }).from(fleetGpsLatestPositions).where(where)

  return rows.map((row) => ({
    ...row,
    vehicleId: row.vehicleId!,
    worksiteId: row.worksiteId ?? "",
  }))
}

export async function loadLatestGpsRows(
  session: Session,
  options: LatestGpsQueryOptions = {},
): Promise<LatestGpsRow[]> {
  if (options.vehicleIds && options.vehicleIds.length === 0) return []
  return selectLatestGps(and(
    isNotNull(fleetGpsLatestPositions.vehicleId),
    worksiteScopeSql(session, fleetGpsLatestPositions.worksiteId, options.worksiteId),
    options.vehicleIds
      ? inArray(fleetGpsLatestPositions.vehicleId, [...options.vehicleIds])
      : undefined,
  ))
}

/** Igual que `loadLatestGpsRows`, pero sin sesión: el llamador ya acotó los equipos. */
export async function loadLatestGpsRowsForVehicles(vehicleIds: readonly string[]): Promise<LatestGpsRow[]> {
  if (vehicleIds.length === 0) return []
  return selectLatestGps(and(
    isNotNull(fleetGpsLatestPositions.vehicleId),
    inArray(fleetGpsLatestPositions.vehicleId, [...vehicleIds]),
  ))
}

export async function loadMergedGpsByVehicle(
  session: Session,
  options: LatestGpsQueryOptions & { now?: Date; staleMinutes?: number } = {},
): Promise<MergedVehicleGps[]> {
  const rows = await loadLatestGpsRows(session, options)
  return mergeLatestGpsByVehicle(rows, { now: options.now, staleMinutes: options.staleMinutes })
}
