/**
 * Sincronización Wialon → `fleet_gps_latest_positions` y `fuel_meter_readings`.
 *
 * Wialon no reemplaza a OnWay: cubre los equipos que OnWay no tiene. La unidad
 * se vincula por link manual, patente, código o nombre; si hay ambigüedad queda
 * pendiente y una persona la resuelve. Nunca se crea un vehículo.
 *
 * Cada corrida reescribe el último mensaje de la unidad. Las lecturas de
 * medidor usan la hora del mensaje como clave natural, así que repetir la
 * corrida no duplica la serie. No se escribe `fuel_telemetry_daily`: VisionLink
 * sigue siendo la fuente diaria de horas/litros de los equipos Cat.
 */
import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsDeviceLinks, fleetGpsLatestPositions, fleetGpsSyncRuns, fuelVehicles } from "@/db/schema"
import { saveMeterReadings, type ParsedMeterReading } from "@/lib/combustibles/meter-readings"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { buildVehicleIdentityIndex, matchVehicleByIdentity, normalizeGpsKey, normalizePlate } from "@/lib/integrations/fleet-gps/identity"
import { fetchWialonUnits, extractWialonTelemetry, logoutWialonSession, WialonClientError } from "./wialon-client"
import type { WialonTelemetryParams, WialonUnit } from "./wialon-contract"
import { loadWialonConfig } from "./wialon-settings"

export type WialonSyncErrorCode =
  | "WIALON_CREDENTIALS_REQUIRED"
  | "WIALON_SNAPSHOT_EMPTY"
  | "WIALON_NO_POSITIONS"
  | "WIALON_SYNC_FAILED"

export class WialonSyncError extends Error {
  constructor(readonly code: WialonSyncErrorCode) {
    super(code)
    this.name = "WialonSyncError"
  }
}

const PLATE_PROPERTY_KEYS = ["plate", "patente", "ppu", "matricula", "matrícula", "dominio"]
const CODE_PROPERTY_KEYS = ["code", "codigo", "código", "interno", "codigo_interno", "código_interno"]

interface VehicleRow {
  id: string
  plate: string
  code: string | null
  worksiteId: string
  meterType: string
  tankCapacityLiters: number | null
}

interface PlannedUnit {
  unit: WialonUnit
  vehicleId: string
  reason: "link" | "plate" | "code" | "text"
}

export interface WialonUnitPlan {
  matched: PlannedUnit[]
  unmatched: WialonUnit[]
  ambiguous: Array<{ unit: WialonUnit; candidates: number }>
  duplicateVehicleWarnings: string[]
}

function propertyValue(unit: WialonUnit, keys: readonly string[]): string | null {
  const entries = new Map(
    Object.entries(unit.customProperties).map(([key, value]) => [key.trim().toLowerCase(), value]),
  )
  for (const key of keys) {
    const value = entries.get(key)
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

/**
 * Resuelve cada unidad contra el catálogo. El link manual manda; después la
 * patente de una propiedad, el código, el nombre y una patente embebida. Una
 * unidad que apunta a un vehículo que ya tiene otro dispositivo se conserva,
 * pero se avisa para que alguien revise si es un duplicado.
 */
export function planWialonUnits(
  units: readonly WialonUnit[],
  vehicles: readonly VehicleRow[],
  links: ReadonlyMap<string, string>,
): WialonUnitPlan {
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const index = buildVehicleIdentityIndex(vehicles)
  const matched: PlannedUnit[] = []
  const unmatched: WialonUnit[] = []
  const ambiguous: WialonUnitPlan["ambiguous"] = []
  const vehicleUsage = new Map<string, number>()

  for (const unit of units) {
    const linkedVehicleId = links.get(unit.id)
    if (linkedVehicleId && vehicleById.has(linkedVehicleId)) {
      matched.push({ unit, vehicleId: linkedVehicleId, reason: "link" })
      vehicleUsage.set(linkedVehicleId, (vehicleUsage.get(linkedVehicleId) ?? 0) + 1)
      continue
    }

    const match = matchVehicleByIdentity({
      plate: propertyValue(unit, PLATE_PROPERTY_KEYS),
      code: propertyValue(unit, CODE_PROPERTY_KEYS),
      name: unit.name,
    }, index)

    if (match.kind === "matched") {
      matched.push({ unit, vehicleId: match.vehicle.id, reason: match.reason })
      vehicleUsage.set(match.vehicle.id, (vehicleUsage.get(match.vehicle.id) ?? 0) + 1)
    } else if (match.kind === "ambiguous") {
      ambiguous.push({ unit, candidates: match.candidates.length })
    } else {
      unmatched.push(unit)
    }
  }

  const duplicateVehicleWarnings = [...vehicleUsage.entries()]
    .filter(([, count]) => count > 1)
    .map(([vehicleId]) => `WIALON_DUPLICATE_UNITS:${vehicleId}`)

  return { matched, unmatched, ambiguous, duplicateVehicleWarnings }
}

export interface SyncWialonOptions {
  trigger?: "manual" | "cron"
  actorUserId?: string
  now?: Date
  fetchImpl?: typeof fetch
}

export interface SyncWialonResult {
  runId: string
  unitsReceived: number
  matched: number
  unmatched: number
  ambiguous: number
  duplicateUnits: number
  removedUnits: number
  positionsUpserted: number
  metersSaved: number
  skippedNoPosition: number
  warnings: string[]
  observedAt: string
}

function telemetryParams(config: Awaited<ReturnType<typeof loadWialonConfig>>): WialonTelemetryParams {
  return {
    odometerParam: config.odometerParam,
    hourMeterParam: config.hourMeterParam,
    fuelLevelParam: config.fuelLevelParam,
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof WialonClientError) return error.code
  if (error instanceof WialonSyncError) return error.code
  if (error instanceof Error && error.message.startsWith("WIALON_")) return error.message
  return "WIALON_SYNC_FAILED"
}

export async function syncWialon(options: SyncWialonOptions = {}): Promise<SyncWialonResult> {
  const config = await loadWialonConfig()
  if (!config.hasCredentials) throw new WialonSyncError("WIALON_CREDENTIALS_REQUIRED")

  const runId = `gpsrun-${nanoid()}`
  await db.insert(fleetGpsSyncRuns).values({
    id: runId,
    provider: "wialon",
    trigger: options.trigger ?? (options.actorUserId ? "manual" : "cron"),
    actorUserId: options.actorUserId,
  })

  try {
    const now = options.now ?? new Date()
    const observedAt = now.toISOString()
    const fetched = await fetchWialonUnits(
      { baseUrl: config.baseUrl, token: config.token },
      { fetchImpl: options.fetchImpl },
    )
    if (fetched.units.length === 0) throw new WialonSyncError("WIALON_SNAPSHOT_EMPTY")

    const [vehicles, links] = await Promise.all([
      db.select({
        id: fuelVehicles.id,
        plate: fuelVehicles.plate,
        code: fuelVehicles.code,
        worksiteId: fuelVehicles.worksiteId,
        meterType: fuelVehicles.meterType,
        tankCapacityLiters: fuelVehicles.tankCapacityLiters,
      }).from(fuelVehicles),
      db.select({
        externalDeviceId: fleetGpsDeviceLinks.externalDeviceId,
        vehicleId: fleetGpsDeviceLinks.vehicleId,
      }).from(fleetGpsDeviceLinks).where(eq(fleetGpsDeviceLinks.provider, "wialon")),
    ])

    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
    const plan = planWialonUnits(fetched.units, vehicles, new Map(links.map((link) => [link.externalDeviceId, link.vehicleId])))
    const matchedByUnit = new Map(plan.matched.map((match) => [match.unit.id, match]))
    const params = telemetryParams(config)

    const telemetryByUnit = new Map<string, ReturnType<typeof extractWialonTelemetry>>()
    for (const unit of fetched.units) {
      const match = matchedByUnit.get(unit.id)
      const tank = match ? vehicleById.get(match.vehicleId)?.tankCapacityLiters ?? null : null
      telemetryByUnit.set(unit.id, extractWialonTelemetry(unit, params, tank))
    }

    const withPosition = fetched.units.filter((unit) => telemetryByUnit.get(unit.id) != null)
    if (withPosition.length === 0) throw new WialonSyncError("WIALON_NO_POSITIONS")

    let positionsUpserted = 0
    let metersSaved = 0
    let removedUnits = 0
    // Una unidad sin vincular o un vehículo con dos unidades no es una falla
    // del proveedor: es trabajo de conciliación. Sólo la truncación del
    // inventario deja la corrida incompleta.
    const warnings: string[] = []
    if (fetched.truncated) warnings.push("WIALON_UNIT_LIMIT")

    await db.transaction(async (tx) => {
      for (const unit of withPosition) {
        const telemetry = telemetryByUnit.get(unit.id)!
        const match = matchedByUnit.get(unit.id)
        const vehicle = match ? vehicleById.get(match.vehicleId) : undefined
        const values = {
          provider: "wialon" as const,
          externalDeviceId: unit.id,
          externalGroupId: unit.groupId ?? "0",
          vehicleId: vehicle?.id ?? null,
          worksiteId: vehicle?.worksiteId ?? null,
          sourcePlate: unit.name,
          normalizedPlate: normalizeGpsKey(unit.name),
          latitude: telemetry.latitude,
          longitude: telemetry.longitude,
          speedKph: telemetry.speedKph,
          headingDegrees: telemetry.headingDegrees,
          ignition: telemetry.ignition ?? false,
          // Wialon no manda el encendido en todos los mensajes. No se inventa
          // un «apagado»: se marca desconocido y, al actualizar, se conserva
          // el último valor conocido.
          sourceStatus: telemetry.ignition === null ? "ignition_unknown" : null,
          gpsReportedAt: telemetry.gpsReportedAt,
          gprsReportedAt: null,
          gpsStatus: telemetry.satellites === null ? null : `sats:${telemetry.satellites}`,
          gprsStatus: null,
          movementState: telemetry.movementState,
          odometer: telemetry.odometer,
          hourMeter: telemetry.hourMeter,
          internalBatteryLevel: null,
          externalPowerVolts: null,
          engineRpm: null,
          coolantTemperature: null,
          fuelLevel: telemetry.fuelLevel,
          temperature1: null,
          humidity1: null,
          driverMappingId: null,
          observedAt,
          syncRunId: runId,
          updatedAt: observedAt,
        }
        await tx.insert(fleetGpsLatestPositions)
          .values({ id: `gpspos-${nanoid()}`, ...values })
          .onConflictDoUpdate({
            target: [fleetGpsLatestPositions.provider, fleetGpsLatestPositions.externalDeviceId],
            set: {
              ...values,
              ignition: sql`CASE
                WHEN COALESCE(${fleetGpsLatestPositions.sourceStatus}, '') <> 'ignition_unknown'
                  AND excluded.source_status = 'ignition_unknown'
                THEN ${fleetGpsLatestPositions.ignition}
                ELSE excluded.ignition
              END`,
              sourceStatus: sql`CASE
                WHEN excluded.source_status = 'ignition_unknown'
                THEN ${fleetGpsLatestPositions.sourceStatus}
                ELSE excluded.source_status
              END`,
            },
          })
        positionsUpserted++
      }

      // Un equipo que desaparece de Wialon no puede seguir apareciendo para
      // siempre con su última posición. Sólo se limpia con un inventario
      // completo: una respuesta truncada no prueba que las demás no existan.
      if (!fetched.truncated) {
        const activeIds = fetched.units.map((unit) => unit.id)
        const removed = await tx.delete(fleetGpsLatestPositions)
          .where(and(
            eq(fleetGpsLatestPositions.provider, "wialon"),
            notInArray(fleetGpsLatestPositions.externalDeviceId, activeIds),
          ))
          .returning({ id: fleetGpsLatestPositions.id })
        removedUnits = removed.length
      }

      const meterReadings: ParsedMeterReading[] = []
      for (const match of plan.matched) {
        const telemetry = telemetryByUnit.get(match.unit.id)
        const vehicle = vehicleById.get(match.vehicleId)
        if (!telemetry || !vehicle || !telemetry.gpsReportedAt) continue
        if (vehicle.meterType !== "odometer" && vehicle.meterType !== "hour_meter") continue
        const value = vehicle.meterType === "odometer" ? telemetry.odometer : telemetry.hourMeter
        if (value === null) continue
        meterReadings.push({
          plate: vehicle.plate,
          sourceRef: `wialon:${match.unit.id}:${vehicle.meterType}:${telemetry.gpsReportedAt}`,
          occurredAt: telemetry.gpsReportedAt,
          value,
          liters: null,
          stationName: null,
          cardNumber: null,
          providerPerformance: null,
          rawPayload: {
            provider: "wialon",
            unitId: match.unit.id,
            param: vehicle.meterType === "odometer" ? config.odometerParam : config.hourMeterParam,
            messageTime: telemetry.gpsReportedAt,
          },
        })
      }

      if (meterReadings.length > 0) {
        // La lectura se escribe con la patente EXACTA del vehículo que hizo
        // match. La normalización sólo sirve de respaldo cuando es única: dos
        // patentes distintas que normalizan igual no deben atribuirse a ciegas.
        const vehicleByExactPlate = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicle]))
        const vehicleByNormalizedPlate = new Map<string, VehicleRow | null>()
        for (const vehicle of vehicles) {
          const key = normalizePlate(vehicle.plate)
          if (!key) continue
          vehicleByNormalizedPlate.set(key, vehicleByNormalizedPlate.has(key) ? null : vehicle)
        }
        const saved = await saveMeterReadings(tx, "gps_wialon", meterReadings, (plate) => {
          const exact = vehicleByExactPlate.get(plate)
          if (exact) return { id: exact.id, meterType: exact.meterType }
          const normalized = vehicleByNormalizedPlate.get(normalizePlate(plate))
          return normalized ? { id: normalized.id, meterType: normalized.meterType } : undefined
        })
        metersSaved = saved.saved
      }

      await tx.update(fleetGpsSyncRuns).set({
        // La truncación del inventario sí es una corrida parcial. Unidades sin
        // vincular, ambiguas o sin posición son contadores de conciliación:
        // marcarlas como falla cada 5 minutos ocultaba las fallas reales.
        status: fetched.truncated ? "partial" : "success",
        devicesReceived: fetched.units.length,
        devicesAccepted: plan.matched.length,
        devicesRejected: fetched.units.length - withPosition.length,
        devicesUnmatched: plan.unmatched.length + plan.ambiguous.length,
        alertsReceived: 0,
        pointsReceived: 0,
        tripsReceived: 0,
        finishedAt: observedAt,
      }).where(eq(fleetGpsSyncRuns.id, runId))
    })

    return {
      runId,
      unitsReceived: fetched.units.length,
      matched: plan.matched.length,
      unmatched: plan.unmatched.length,
      ambiguous: plan.ambiguous.length,
      duplicateUnits: plan.duplicateVehicleWarnings.length,
      removedUnits,
      positionsUpserted,
      metersSaved,
      skippedNoPosition: fetched.units.length - withPosition.length,
      warnings,
      observedAt,
    }
  } catch (error) {
    await db.update(fleetGpsSyncRuns).set({
      status: "failed",
      errorCode: safeErrorCode(error),
      finishedAt: new Date().toISOString(),
    }).where(eq(fleetGpsSyncRuns.id, runId)).catch(() => undefined)
    logger.error("[flota/wialon/sync]", { code: safeErrorCode(error) })
    if (error instanceof WialonClientError || error instanceof WialonSyncError) throw error
    throw new WialonSyncError("WIALON_SYNC_FAILED")
  } finally {
    // La sesión de Wialon no se reutiliza entre corridas: se cierra para no
    // dejar sesiones colgadas ni sumar un timeout extra al runner.
    try {
      await logoutWialonSession(
        { baseUrl: config.baseUrl, token: config.token },
        { fetchImpl: options.fetchImpl },
      )
    } catch {
      // El logout es best-effort: nunca debe cambiar el resultado de la corrida.
    }
  }
}

/**
 * ¿La corrida que tiene el lock está colgada? Igual que OnWay: una corrida de
 * cron que quedó `running` no debe verse sana para siempre.
 */
export async function hasStalledWialonCronRun(now = new Date()): Promise<boolean> {
  const [latest] = await db.select({ status: fleetGpsSyncRuns.status, startedAt: fleetGpsSyncRuns.startedAt })
    .from(fleetGpsSyncRuns)
    .where(and(eq(fleetGpsSyncRuns.trigger, "cron"), eq(fleetGpsSyncRuns.provider, "wialon")))
    .orderBy(desc(fleetGpsSyncRuns.startedAt))
    .limit(1)
  if (!latest || latest.status !== "running") return false
  return now.getTime() - new Date(latest.startedAt).getTime() > 15 * 60_000
}
