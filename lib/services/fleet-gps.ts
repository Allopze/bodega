import type { Session } from "next-auth"
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsAlerts, fleetGpsDriverMappings, fleetGpsLatestPositions, fleetGpsPositionHistory, fleetGpsSyncRuns, fleetGpsTrips, fuelVehicles, workers, worksites } from "@/db/schema"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface FleetGpsPosition {
  id: string
  vehicleId: string
  plate: string
  code: string | null
  brand: string | null
  model: string | null
  worksiteName: string
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number
  ignition: boolean
  sourceStatus: string | null
  gpsReportedAt: string | null
  gprsReportedAt: string | null
  gpsStatus: string | null
  gprsStatus: string | null
  movementState: string | null
  odometer: number | null
  hourMeter: number | null
  driverName: string | null
  observedAt: string
}

/**
 * ¿La última captura de OnWay quedó fuera de la ventana de frescura?
 *
 * Compara INSTANTES, no texto: `observedAt` es `timestamptz mode:"string"` y
 * drizzle lo serializa con separador de espacio ("2026-09-19 12:00:00.000+00"),
 * mientras `staleBefore` es ISO ("...T...Z"). Un `<` sobre los strings decidía
 * en el carácter del separador (' ' < 'T') y marcaba toda captura del mismo día
 * como desactualizada, aunque OnWay hubiera sincronizado un minuto antes.
 */
export function isGpsCaptureStale(latestCapture: string | null, staleBefore: string): boolean {
  if (!latestCapture) return false
  const capture = Date.parse(latestCapture)
  const threshold = Date.parse(staleBefore)
  return Number.isFinite(capture) && Number.isFinite(threshold) && capture < threshold
}

export async function getFleetGpsMonitoring(session: Session) {
  const rawPositions = await db.select({
    id: fleetGpsLatestPositions.id,
    vehicleId: fuelVehicles.id,
    plate: fuelVehicles.plate,
    code: fuelVehicles.code,
    brand: fuelVehicles.brand,
    model: fuelVehicles.model,
    worksiteName: worksites.name,
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
    driverFirstName: workers.firstName,
    driverLastName: workers.lastName,
    driverWorksiteId: workers.worksiteId,
    observedAt: fleetGpsLatestPositions.observedAt,
  }).from(fleetGpsLatestPositions)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsLatestPositions.vehicleId))
    .innerJoin(worksites, eq(worksites.id, fleetGpsLatestPositions.worksiteId))
    .leftJoin(fleetGpsDriverMappings, eq(fleetGpsDriverMappings.id, fleetGpsLatestPositions.driverMappingId))
    .leftJoin(workers, eq(workers.id, fleetGpsDriverMappings.workerId))
    .where(worksiteScopeSql(session, fleetGpsLatestPositions.worksiteId))
    .orderBy(fuelVehicles.plate)

  const canViewDriver = can(session, "flota:view_gps_driver")
  const positions: FleetGpsPosition[] = rawPositions.map(({ driverFirstName, driverLastName, driverWorksiteId, ...position }) => ({
    ...position,
    driverName: canViewDriver && driverWorksiteId && canAccessWorksite(session, driverWorksiteId)
      ? `${driverFirstName ?? ""} ${driverLastName ?? ""}`.trim() || null
      : null,
  }))

  const canManage = can(session, "flota:manage_gps")
  const [latestRun, unmatched] = canManage
    ? await Promise.all([
        db.query.fleetGpsSyncRuns.findFirst({ orderBy: [desc(fleetGpsSyncRuns.startedAt)] }),
        db.$count(fleetGpsLatestPositions, isNull(fleetGpsLatestPositions.vehicleId)),
      ])
    : [null, null]

  return {
    positions,
    canManage,
    latestRun,
    unmatched,
    staleBefore: new Date(Date.now() - 15 * 60_000).toISOString(),
  }
}

export async function getFleetGpsAlerts(session: Session, limit = 200) {
  const rows = await db.select({
    id: fleetGpsAlerts.id, vehicleId: fleetGpsAlerts.vehicleId, plate: fuelVehicles.plate,
    worksiteName: worksites.name, alertType: fleetGpsAlerts.alertType, title: fleetGpsAlerts.title,
    priority: fleetGpsAlerts.priority, occurredAt: fleetGpsAlerts.occurredAt,
    processingStatus: fleetGpsAlerts.processingStatus, linkedEntityType: fleetGpsAlerts.linkedEntityType,
    linkedEntityId: fleetGpsAlerts.linkedEntityId, ruleId: fleetGpsAlerts.ruleId,
  }).from(fleetGpsAlerts)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsAlerts.vehicleId))
    .innerJoin(worksites, eq(worksites.id, fleetGpsAlerts.worksiteId))
    .where(worksiteScopeSql(session, fleetGpsAlerts.worksiteId))
    .orderBy(desc(fleetGpsAlerts.occurredAt)).limit(Math.min(Math.max(limit, 1), 500))
  return rows
}

export async function getFleetGpsHistory(session: Session, vehicleId: string, from: string, to: string) {
  if (!can(session, "flota:view_gps_history")) throw new Error("Sin permiso para ver historial GPS")
  const start = new Date(from)
  const end = new Date(to)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || end.getTime() - start.getTime() > 31 * 86_400_000) {
    throw new Error("El historial permite un rango de hasta 30 días")
  }
  const scope = worksiteScopeSql(session, fleetGpsPositionHistory.worksiteId)
  const [points, trips] = await Promise.all([
    db.select().from(fleetGpsPositionHistory).where(and(scope, eq(fleetGpsPositionHistory.vehicleId, vehicleId), gte(fleetGpsPositionHistory.occurredAt, start.toISOString()), lte(fleetGpsPositionHistory.occurredAt, end.toISOString()))).orderBy(fleetGpsPositionHistory.occurredAt).limit(20_000),
    db.select().from(fleetGpsTrips).where(and(worksiteScopeSql(session, fleetGpsTrips.worksiteId), eq(fleetGpsTrips.vehicleId, vehicleId), gte(fleetGpsTrips.startedAt, start.toISOString()), lte(fleetGpsTrips.startedAt, end.toISOString()))).orderBy(desc(fleetGpsTrips.startedAt)).limit(2_000),
  ])
  return { points, trips }
}
