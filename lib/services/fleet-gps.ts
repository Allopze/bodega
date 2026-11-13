import type { Session } from "next-auth"
import { and, desc, eq, gte, isNull, lte, notExists, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsAlerts, fleetGpsDeviceLinks, fleetGpsDriverMappings, fleetGpsLatestPositions, fleetGpsPositionHistory, fleetGpsSyncRuns, fleetGpsTrips, fuelVehicles, workers, worksites } from "@/db/schema"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { mergeLatestGpsByVehicle, type LatestGpsRow } from "@/lib/integrations/fleet-gps/merge-latest"

export interface FleetGpsSource {
  provider: string
  observedAt: string
  gpsReportedAt: string | null
}

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
  ignitionKnown: boolean
  sourceStatus: string | null
  gpsReportedAt: string | null
  gprsReportedAt: string | null
  gpsStatus: string | null
  gprsStatus: string | null
  movementState: string | null
  odometer: number | null
  odometerAt: string | null
  hourMeter: number | null
  hourMeterAt: string | null
  /** Proveedor del que salieron odómetro y horómetro. */
  meterProvider: string | null
  fuelLevel: number | null
  fuelLevelAt: string | null
  driverName: string | null
  gpsIsStale: boolean
  observedAt: string
  provider: string
  providers: string[]
  primaryProvider: string
  sources: FleetGpsSource[]
}

export type GpsProvider = "onway" | "wialon"

export interface FleetGpsProviderRun {
  provider: string
  id: string
  status: string
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  devicesReceived: number
  devicesAccepted: number
  devicesUnmatched: number
}

/** Compares a GPS timestamp with the freshness threshold as instants, not text. */
export function isGpsCaptureStale(latestCapture: string | null, staleBefore: string): boolean {
  if (!latestCapture) return false
  const capture = Date.parse(latestCapture)
  const threshold = Date.parse(staleBefore)
  return Number.isFinite(capture) && Number.isFinite(threshold) && capture < threshold
}

type RawPositionRow = Awaited<ReturnType<typeof loadRawPositions>>[number]

async function loadRawPositions(session: Session) {
  return db.select({
    id: fleetGpsLatestPositions.id,
    provider: fleetGpsLatestPositions.provider,
    externalDeviceId: fleetGpsLatestPositions.externalDeviceId,
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
    metersReportedAt: fleetGpsLatestPositions.metersReportedAt,
    gprsReportedAt: fleetGpsLatestPositions.gprsReportedAt,
    gpsStatus: fleetGpsLatestPositions.gpsStatus,
    gprsStatus: fleetGpsLatestPositions.gprsStatus,
    movementState: fleetGpsLatestPositions.movementState,
    odometer: fleetGpsLatestPositions.odometer,
    hourMeter: fleetGpsLatestPositions.hourMeter,
    fuelLevel: fleetGpsLatestPositions.fuelLevel,
    driverMappingId: fleetGpsLatestPositions.driverMappingId,
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
}

function toMergeRow(row: RawPositionRow): LatestGpsRow {
  return {
    id: row.id,
    provider: row.provider,
    externalDeviceId: row.externalDeviceId,
    vehicleId: row.vehicleId,
    worksiteId: null,
    sourcePlate: row.plate,
    normalizedPlate: row.plate,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKph: row.speedKph,
    headingDegrees: row.headingDegrees,
    ignition: row.ignition,
    sourceStatus: row.sourceStatus,
    gpsReportedAt: row.gpsReportedAt,
    metersReportedAt: row.metersReportedAt,
    gprsReportedAt: row.gprsReportedAt,
    gpsStatus: row.gpsStatus,
    gprsStatus: row.gprsStatus,
    movementState: row.movementState,
    odometer: row.odometer,
    hourMeter: row.hourMeter,
    internalBatteryLevel: null,
    externalPowerVolts: null,
    engineRpm: null,
    coolantTemperature: null,
    fuelLevel: row.fuelLevel,
    temperature1: null,
    humidity1: null,
    driverMappingId: row.driverMappingId,
    observedAt: row.observedAt,
  }
}

/**
 * Dispositivos sin vehículo que una persona todavía tiene que resolver: sin
 * vínculo y sin haber sido declarados «excluidos» (equipo de terceros, unidad
 * de prueba). Una exclusión no es trabajo pendiente.
 */
function pendingDeviceFilter(provider: GpsProvider) {
  return and(
    eq(fleetGpsLatestPositions.provider, provider),
    isNull(fleetGpsLatestPositions.vehicleId),
    notExists(
      db.select({ one: sql`1` }).from(fleetGpsDeviceLinks).where(and(
        eq(fleetGpsDeviceLinks.provider, fleetGpsLatestPositions.provider),
        eq(fleetGpsDeviceLinks.externalDeviceId, fleetGpsLatestPositions.externalDeviceId),
        eq(fleetGpsDeviceLinks.status, "excluded"),
      )),
    ),
  )
}

export async function getFleetGpsMonitoring(session: Session) {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const rawPositions = await loadRawPositions(session)

  const vehicleInfo = new Map<string, Pick<RawPositionRow, "plate" | "code" | "brand" | "model" | "worksiteName">>()
  const driverByMappingId = new Map<string, Pick<RawPositionRow, "driverFirstName" | "driverLastName" | "driverWorksiteId">>()
  const providerLatestAt: Record<"onway" | "wialon", string | null> = { onway: null, wialon: null }
  for (const row of rawPositions) {
    if (!vehicleInfo.has(row.vehicleId)) {
      vehicleInfo.set(row.vehicleId, {
        plate: row.plate,
        code: row.code,
        brand: row.brand,
        model: row.model,
        worksiteName: row.worksiteName,
      })
    }
    if (row.driverMappingId) {
      driverByMappingId.set(row.driverMappingId, {
        driverFirstName: row.driverFirstName,
        driverLastName: row.driverLastName,
        driverWorksiteId: row.driverWorksiteId,
      })
    }
    if (row.provider === "onway" || row.provider === "wialon") {
      const at = row.gpsReportedAt ?? row.observedAt
      if (!providerLatestAt[row.provider] || at > providerLatestAt[row.provider]!) {
        providerLatestAt[row.provider] = at
      }
    }
  }

  const canViewDriver = can(session, "flota:view_gps_driver")
  const merged = mergeLatestGpsByVehicle(rawPositions.map(toMergeRow), { staleMinutes: 15 })
  const positions: FleetGpsPosition[] = merged.flatMap((position) => {
    const info = vehicleInfo.get(position.vehicleId)
    if (!info) return []
    const driver = position.driverMappingId ? driverByMappingId.get(position.driverMappingId) : undefined
    const driverName = canViewDriver && driver?.driverWorksiteId && canAccessWorksite(session, driver.driverWorksiteId)
      ? `${driver.driverFirstName ?? ""} ${driver.driverLastName ?? ""}`.trim() || null
      : null
    return [{
      ...position,
      ...info,
      driverName,
      gpsIsStale: position.gpsIsStale || isGpsCaptureStale(position.gpsReportedAt, staleBefore),
    }]
  })

  const canManage = can(session, "flota:manage_gps")
  let providerRuns: Record<"onway" | "wialon", FleetGpsProviderRun | null> = { onway: null, wialon: null }
  let unmatchedByProvider: Record<"onway" | "wialon", number | null> = { onway: null, wialon: null }

  if (canManage) {
    const [onwayRun, wialonRun, onwayUnmatched, wialonUnmatched] = await Promise.all([
      db.query.fleetGpsSyncRuns.findFirst({
        where: eq(fleetGpsSyncRuns.provider, "onway"),
        orderBy: [desc(fleetGpsSyncRuns.startedAt)],
      }),
      db.query.fleetGpsSyncRuns.findFirst({
        where: eq(fleetGpsSyncRuns.provider, "wialon"),
        orderBy: [desc(fleetGpsSyncRuns.startedAt)],
      }),
      db.$count(fleetGpsLatestPositions, pendingDeviceFilter("onway")),
      db.$count(fleetGpsLatestPositions, pendingDeviceFilter("wialon")),
    ])

    providerRuns = { onway: onwayRun ?? null, wialon: wialonRun ?? null }
    unmatchedByProvider = { onway: onwayUnmatched, wialon: wialonUnmatched }
  }

  const unmatched = canManage
    ? (unmatchedByProvider.onway ?? 0) + (unmatchedByProvider.wialon ?? 0)
    : null

  return {
    positions,
    canManage,
    latestRun: providerRuns.onway,
    providerRuns,
    /** Última captura real de cada proveedor: una caída no se tapa con la otra. */
    providerLatestAt,
    unmatched,
    unmatchedByProvider,
    staleBefore,
  }
}

export async function getFleetGpsAlerts(session: Session, limit = 200) {
  const rows = await db.select({
    id: fleetGpsAlerts.id, provider: fleetGpsAlerts.provider, vehicleId: fleetGpsAlerts.vehicleId, plate: fuelVehicles.plate,
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

/** Un dispositivo GPS (equipo OnWay o unidad Wialon) con su vínculo actual. */
export interface GpsLinkableDevice {
  provider: GpsProvider
  unitId: string
  unitName: string
  observedAt: string
  gpsReportedAt: string | null
  vehicleId: string | null
  plate: string | null
  code: string | null
  worksiteName: string | null
  manualLinkId: string | null
}

/** Un dispositivo que una persona declaró ajeno a la flota. */
export interface ExcludedGpsDevice {
  provider: GpsProvider
  unitId: string
  /** `null` si el proveedor ya no lo informa. */
  unitName: string | null
  reason: string
  excludedAt: string
}

export interface LinkableVehicle {
  id: string
  plate: string
  code: string | null
  worksiteName: string
}

/**
 * Dispositivos de ambos proveedores con su vínculo actual, para la pantalla de
 * configuración. Sólo `flota:manage_gps`; los dispositivos sin vehículo no
 * tienen faena, así que se listan globalmente para que una persona los
 * resuelva. Los excluidos no aparecen: tienen su propia lista.
 */
export async function listGpsDevicesForLinking(session: Session, limit = 200): Promise<GpsLinkableDevice[]> {
  if (!can(session, "flota:manage_gps")) return []
  const scope = worksiteScopeSql(session, fuelVehicles.worksiteId)
  const rows = await db.select({
    provider: fleetGpsLatestPositions.provider,
    unitId: fleetGpsLatestPositions.externalDeviceId,
    unitName: fleetGpsLatestPositions.sourcePlate,
    observedAt: fleetGpsLatestPositions.observedAt,
    gpsReportedAt: fleetGpsLatestPositions.gpsReportedAt,
    vehicleId: fleetGpsLatestPositions.vehicleId,
    plate: fuelVehicles.plate,
    code: fuelVehicles.code,
    worksiteName: worksites.name,
    manualLinkId: fleetGpsDeviceLinks.id,
  }).from(fleetGpsLatestPositions)
    .leftJoin(fleetGpsDeviceLinks, and(
      eq(fleetGpsDeviceLinks.provider, fleetGpsLatestPositions.provider),
      eq(fleetGpsDeviceLinks.externalDeviceId, fleetGpsLatestPositions.externalDeviceId),
    ))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsLatestPositions.vehicleId))
    .leftJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(
      or(eq(fleetGpsLatestPositions.provider, "onway"), eq(fleetGpsLatestPositions.provider, "wialon")),
      or(isNull(fleetGpsDeviceLinks.status), eq(fleetGpsDeviceLinks.status, "linked")),
      // Un dispositivo vinculado a un equipo de otra faena no se puede reasignar
      // desde acá. Los no vinculados no tienen faena: se dejan ver para que
      // alguien del alcance los resuelva.
      scope ? or(isNull(fleetGpsLatestPositions.vehicleId), scope) : undefined,
    ))
    .orderBy(
      sql`${fleetGpsLatestPositions.vehicleId} IS NULL DESC`,
      fleetGpsLatestPositions.provider,
      fleetGpsLatestPositions.sourcePlate,
    )
    .limit(Math.min(Math.max(limit, 1), 1_000))
  return rows.map((row) => ({ ...row, provider: row.provider as GpsProvider }))
}

/**
 * Dispositivos excluidos, con el motivo que dejó quien los excluyó. Se lee
 * desde los vínculos y no desde las posiciones: si el proveedor deja de
 * informar el dispositivo, la exclusión sigue ahí y se puede restaurar.
 */
export async function listExcludedGpsDevices(session: Session): Promise<ExcludedGpsDevice[]> {
  if (!can(session, "flota:manage_gps")) return []
  const rows = await db.select({
    provider: fleetGpsDeviceLinks.provider,
    unitId: fleetGpsDeviceLinks.externalDeviceId,
    unitName: fleetGpsLatestPositions.sourcePlate,
    reason: fleetGpsDeviceLinks.reason,
    excludedAt: fleetGpsDeviceLinks.updatedAt,
  }).from(fleetGpsDeviceLinks)
    .leftJoin(fleetGpsLatestPositions, and(
      eq(fleetGpsLatestPositions.provider, fleetGpsDeviceLinks.provider),
      eq(fleetGpsLatestPositions.externalDeviceId, fleetGpsDeviceLinks.externalDeviceId),
    ))
    .where(eq(fleetGpsDeviceLinks.status, "excluded"))
    .orderBy(fleetGpsDeviceLinks.provider, fleetGpsDeviceLinks.externalDeviceId)
  return rows.map((row) => ({
    provider: row.provider as GpsProvider,
    unitId: row.unitId,
    unitName: row.unitName,
    reason: row.reason ?? "",
    excludedAt: row.excludedAt,
  }))
}

/** Vehículos activos del alcance para el selector de vínculo. */
export async function listLinkableVehicles(session: Session, limit = 500): Promise<LinkableVehicle[]> {
  if (!can(session, "flota:manage_gps")) return []
  return db.select({
    id: fuelVehicles.id,
    plate: fuelVehicles.plate,
    code: fuelVehicles.code,
    worksiteName: worksites.name,
  }).from(fuelVehicles)
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      worksiteScopeSql(session, fuelVehicles.worksiteId),
    ))
    .orderBy(fuelVehicles.plate)
    .limit(Math.min(Math.max(limit, 1), 1_000))
}
