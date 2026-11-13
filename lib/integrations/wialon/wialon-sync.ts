/**
 * Sincronización Wialon → `fleet_gps_latest_positions` y `fuel_meter_readings`.
 *
 * Wialon no reemplaza a OnWay: cubre los equipos que OnWay no tiene. La unidad
 * se resuelve, en este orden, por vínculo manual, exclusión, patente del perfil
 * (`registration_plate`), patente de las propiedades internas, VIN contra el
 * número de serie del catálogo, código y nombre; si hay ambigüedad queda
 * pendiente y una persona la resuelve. Nunca se crea un vehículo.
 *
 * Cada corrida reescribe el último mensaje de la unidad. Las lecturas de
 * medidor llevan la hora del mensaje y su clave natural es la HORA UTC: repetir
 * la corrida no duplica la serie y una unidad que reporta cada 5 minutos deja
 * una lectura por hora, no 12. No se escribe `fuel_telemetry_daily`:
 * VisionLink sigue siendo la fuente diaria de horas/litros de los equipos Cat.
 */
import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsDeviceLinks, fleetGpsLatestPositions, fleetGpsSyncRuns, fuelVehicles } from "@/db/schema"
import { saveMeterReadings, type ParsedMeterReading } from "@/lib/combustibles/meter-readings"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  buildVehicleIdentityIndex,
  buildVehicleResolverByPlate,
  matchVehicleByIdentity,
  normalizeGpsKey,
} from "@/lib/integrations/fleet-gps/identity"
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
  serialNumber: string | null
  worksiteId: string
  meterType: string
  tankCapacityLiters: number | null
}

/** Estado de un vínculo guardado: apunta a un vehículo, o la unidad se declaró ajena a la flota. */
export interface WialonLinkState {
  status: "linked" | "excluded"
  vehicleId: string | null
}

interface PlannedUnit {
  unit: WialonUnit
  vehicleId: string
  reason: "link" | "plate" | "vin" | "code" | "text"
}

export interface WialonUnitPlan {
  matched: PlannedUnit[]
  unmatched: WialonUnit[]
  ambiguous: Array<{ unit: WialonUnit; candidates: number }>
  /** Unidades que una persona declaró ajenas a la flota: no son trabajo pendiente. */
  excluded: WialonUnit[]
  /** Vehículos con más de una unidad apuntándoles (un aviso, no un cambio de estado). */
  duplicateVehicleIds: string[]
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
 * Resuelve cada unidad contra el catálogo, en este orden: vínculo manual,
 * exclusión, patente del perfil de Wialon, patente de las propiedades
 * internas (respaldo), VIN contra el número de serie, código y nombre. Un
 * vínculo manual a un vehículo que ya no existe se ignora y la unidad vuelve al
 * cruce automático. Una unidad que apunta a un vehículo que ya tiene otro
 * dispositivo se conserva, pero se avisa para que alguien revise si es un
 * duplicado.
 */
export function planWialonUnits(
  units: readonly WialonUnit[],
  vehicles: readonly VehicleRow[],
  links: ReadonlyMap<string, WialonLinkState>,
): WialonUnitPlan {
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const index = buildVehicleIdentityIndex(vehicles)
  const bySerial = new Map<string, VehicleRow[]>()
  for (const vehicle of vehicles) {
    const key = vehicle.serialNumber ? normalizeGpsKey(vehicle.serialNumber) : ""
    if (key) bySerial.set(key, [...(bySerial.get(key) ?? []), vehicle])
  }
  const matched: PlannedUnit[] = []
  const unmatched: WialonUnit[] = []
  const ambiguous: WialonUnitPlan["ambiguous"] = []
  const excluded: WialonUnit[] = []
  const vehicleUsage = new Map<string, number>()

  const accept = (unit: WialonUnit, vehicleId: string, reason: PlannedUnit["reason"]) => {
    matched.push({ unit, vehicleId, reason })
    vehicleUsage.set(vehicleId, (vehicleUsage.get(vehicleId) ?? 0) + 1)
  }

  for (const unit of units) {
    const link = links.get(unit.id)
    if (link?.status === "linked" && link.vehicleId && vehicleById.has(link.vehicleId)) {
      accept(unit, link.vehicleId, "link")
      continue
    }
    if (link?.status === "excluded") {
      excluded.push(unit)
      continue
    }

    // La patente manda sobre todo lo demás: primero la del perfil, que es el
    // campo pensado para eso, y las propiedades internas sólo como respaldo.
    let resolved: "matched" | "ambiguous" | null = null
    const plates = [...new Set([unit.profile.registrationPlate, propertyValue(unit, PLATE_PROPERTY_KEYS)]
      .filter((plate): plate is string => Boolean(plate)))]
    for (const plate of plates) {
      const match = matchVehicleByIdentity({ plate }, index)
      if (match.kind === "matched") {
        accept(unit, match.vehicle.id, "plate")
        resolved = "matched"
        break
      }
      if (match.kind === "ambiguous") {
        ambiguous.push({ unit, candidates: match.candidates.length })
        resolved = "ambiguous"
        break
      }
    }
    if (resolved) continue

    const vinKey = unit.profile.vin ? normalizeGpsKey(unit.profile.vin) : ""
    const vinCandidates = vinKey ? bySerial.get(vinKey) : undefined
    if (vinCandidates?.length === 1) {
      accept(unit, vinCandidates[0]!.id, "vin")
      continue
    }
    if (vinCandidates && vinCandidates.length > 1) {
      ambiguous.push({ unit, candidates: vinCandidates.length })
      continue
    }

    const match = matchVehicleByIdentity({
      code: propertyValue(unit, CODE_PROPERTY_KEYS),
      name: unit.name,
    }, index)
    if (match.kind === "matched") accept(unit, match.vehicle.id, match.reason)
    else if (match.kind === "ambiguous") ambiguous.push({ unit, candidates: match.candidates.length })
    else unmatched.push(unit)
  }

  const duplicateVehicleIds = [...vehicleUsage.entries()]
    .filter(([, count]) => count > 1)
    .map(([vehicleId]) => vehicleId)

  return {
    matched,
    unmatched,
    ambiguous,
    excluded,
    duplicateVehicleIds,
    duplicateVehicleWarnings: duplicateVehicleIds.map((vehicleId) => `WIALON_DUPLICATE_UNITS:${vehicleId}`),
  }
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
  /** Unidades excluidas por una persona: no cuentan como pendientes. */
  excluded: number
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

/**
 * Clave natural de una lectura de medidor: unidad, medidor y HORA UTC del
 * mensaje. `saveMeterReadings` hace upsert por esta clave, así que la serie
 * guarda una lectura por hora (la última de esa hora) en vez de una por corrida.
 */
export function meterSourceRef(unitId: string, meterType: string, occurredAt: string): string {
  return `wialon:${unitId}:${meterType}:${occurredAt.slice(0, 13)}Z`
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
        serialNumber: fuelVehicles.serialNumber,
        worksiteId: fuelVehicles.worksiteId,
        meterType: fuelVehicles.meterType,
        tankCapacityLiters: fuelVehicles.tankCapacityLiters,
      }).from(fuelVehicles),
      db.select({
        externalDeviceId: fleetGpsDeviceLinks.externalDeviceId,
        status: fleetGpsDeviceLinks.status,
        vehicleId: fleetGpsDeviceLinks.vehicleId,
      }).from(fleetGpsDeviceLinks).where(eq(fleetGpsDeviceLinks.provider, "wialon")),
    ])

    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
    const plan = planWialonUnits(fetched.units, vehicles, new Map(links.map((link) => [
      link.externalDeviceId,
      { status: link.status === "excluded" ? "excluded" : "linked", vehicleId: link.vehicleId } satisfies WialonLinkState,
    ])))
    if (plan.duplicateVehicleIds.length > 0) {
      // Un aviso para quien revise la flota: varias unidades en un mismo
      // vehículo suelen ser un equipo duplicado en Wialon o un cruce errado.
      logger.warn("[flota/wialon/sync] varias unidades apuntan al mismo vehículo", {
        vehicleIds: plan.duplicateVehicleIds,
      })
    }
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
          // Wialon no entrega un grupo en `avl_unit`; la columna es obligatoria.
          externalGroupId: "0",
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
          metersReportedAt: telemetry.metersReportedAt,
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
        if (!telemetry || !vehicle) continue
        if (vehicle.meterType !== "odometer" && vehicle.meterType !== "hour_meter") continue
        // La hora de la lectura es la del mensaje del que salió el medidor, no
        // la de la última posición GPS.
        const occurredAt = telemetry.metersReportedAt ?? telemetry.gpsReportedAt
        const value = vehicle.meterType === "odometer" ? telemetry.odometer : telemetry.hourMeter
        if (!occurredAt || value === null) continue
        meterReadings.push({
          plate: vehicle.plate,
          sourceRef: meterSourceRef(match.unit.id, vehicle.meterType, occurredAt),
          occurredAt,
          value,
          liters: null,
          stationName: null,
          cardNumber: null,
          providerPerformance: null,
          rawPayload: {
            provider: "wialon",
            unitId: match.unit.id,
            // Vacío = contador de Wialon (cnm / cneh).
            param: (vehicle.meterType === "odometer" ? config.odometerParam : config.hourMeterParam) || "counter",
            messageTime: occurredAt,
          },
        })
      }

      if (meterReadings.length > 0) {
        const saved = await saveMeterReadings(tx, "gps_wialon", meterReadings, buildVehicleResolverByPlate(vehicles))
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
        // Las excluidas no cuentan: declarar que un equipo es ajeno a la flota
        // lo saca de lo pendiente.
        devicesUnmatched: plan.unmatched.length + plan.ambiguous.length,
        alertsReceived: 0,
        pointsReceived: 0,
        tripsReceived: 0,
        // La hora real de término; `observedAt` es la de inicio de la lectura.
        finishedAt: new Date().toISOString(),
      }).where(eq(fleetGpsSyncRuns.id, runId))
    })

    return {
      runId,
      unitsReceived: fetched.units.length,
      matched: plan.matched.length,
      unmatched: plan.unmatched.length,
      ambiguous: plan.ambiguous.length,
      excluded: plan.excluded.length,
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

export interface RefreshWialonPositionsResult {
  observedAt: string
  /** Unidades ya presentes cuya posición se actualizó. */
  updated: number
}

/**
 * Lectura en vivo: sólo la posición de unidades que YA están en
 * `fleet_gps_latest_positions`. No inserta, no borra, no cambia de vehículo y
 * no escribe lecturas de medidor ni corridas en la bitácora (serían 8.640 al
 * día): todo eso es del cron de 5 minutos. Reutiliza la sesión cacheada del
 * cliente y NO la cierra; la corrida del cron sí lo hace, y la siguiente
 * lectura en vivo abre una nueva.
 */
export async function refreshWialonPositions(
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<RefreshWialonPositionsResult> {
  const config = await loadWialonConfig()
  if (!config.hasCredentials) throw new WialonSyncError("WIALON_CREDENTIALS_REQUIRED")

  const observedAt = (options.now ?? new Date()).toISOString()
  try {
    const fetched = await fetchWialonUnits(
      { baseUrl: config.baseUrl, token: config.token },
      { fetchImpl: options.fetchImpl, positionsOnly: true },
    )
    if (fetched.units.length === 0) throw new WialonSyncError("WIALON_SNAPSHOT_EMPTY")

    const params = telemetryParams(config)
    const updates = fetched.units.flatMap((unit) => {
      const telemetry = extractWialonTelemetry(unit, params)
      return telemetry ? [{ unitId: unit.id, telemetry }] : []
    })

    let updated = 0
    await db.transaction(async (tx) => {
      for (const { unitId, telemetry } of updates) {
        const rows = await tx.update(fleetGpsLatestPositions).set({
          latitude: telemetry.latitude,
          longitude: telemetry.longitude,
          speedKph: telemetry.speedKph,
          headingDegrees: telemetry.headingDegrees,
          gpsReportedAt: telemetry.gpsReportedAt,
          gpsStatus: telemetry.satellites === null ? null : `sats:${telemetry.satellites}`,
          movementState: telemetry.movementState,
          // Un mensaje sin encendido no lo pisa: se conserva el último valor conocido.
          ...(telemetry.ignition === null ? {} : { ignition: telemetry.ignition, sourceStatus: null }),
          observedAt,
          updatedAt: observedAt,
        }).where(and(
          eq(fleetGpsLatestPositions.provider, "wialon"),
          eq(fleetGpsLatestPositions.externalDeviceId, unitId),
        )).returning({ id: fleetGpsLatestPositions.id })
        updated += rows.length
      }
    })
    return { observedAt, updated }
  } catch (error) {
    if (error instanceof WialonClientError || error instanceof WialonSyncError) throw error
    throw new WialonSyncError("WIALON_SYNC_FAILED")
  }
}
