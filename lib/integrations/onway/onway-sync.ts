import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetGpsAlerts,
  fleetGpsAlertTypes,
  fleetGpsLatestPositions,
  fleetGpsPositionHistory,
  fleetGpsSyncRuns,
  fleetGpsTrips,
  fuelVehicles,
} from "@/db/schema"
import { saveMeterReadings, type ParsedMeterReading } from "@/lib/combustibles/meter-readings"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { fetchOnwayTelemetry, OnwayClientError } from "./onway-client"
import { resolveOnwayDriverMappings } from "./onway-driver-mappings"
import { reconcileOnwayDevices } from "./onway-reconciliation"
import { readOnwayConfig } from "./onway-settings"
import { applyOnwayAlertRules } from "./onway-automation"

export interface SyncOnwayOptions {
  trigger?: "manual" | "cron"
  actorUserId?: string
  now?: Date
  includeHistory?: boolean
}

export interface SyncOnwayResult {
  runId: string
  received: number
  matched: number
  rejected: number
  unmatched: number
  unmatchedPlates: string[]
  observedAt: string
  alerts: number
  points: number
  trips: number
  warnings: string[]
}

function historyWindow(options: SyncOnwayOptions, now: Date): { from: string; to: string } | null {
  if (options.includeHistory === false) return null
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value)
  const minute = Number(parts.find((part) => part.type === "minute")?.value)
  if (options.includeHistory !== true && minute !== 0) return null
  const hours = hour === 3 ? 24 : 2
  return { from: new Date(now.getTime() - hours * 60 * 60_000).toISOString(), to: now.toISOString() }
}

function telemetryMeterReading(input: {
  plate: string
  externalDeviceId: string
  occurredAt: string
  meterType: string
  odometer: number | null
  hourMeter: number | null
}): ParsedMeterReading | null {
  const value = input.meterType === "odometer" ? input.odometer : input.meterType === "hour_meter" ? input.hourMeter : null
  if (value === null) return null
  return {
    plate: input.plate,
    sourceRef: `onway:${input.externalDeviceId}:${input.meterType}:${input.occurredAt}`,
    occurredAt: input.occurredAt,
    value,
    liters: null,
    stationName: null,
    cardNumber: null,
    providerPerformance: null,
    rawPayload: { provider: "onway", externalDeviceId: input.externalDeviceId, occurredAt: input.occurredAt },
  }
}

async function insertInBatches<T>(values: T[], size: number, insert: (batch: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < values.length; offset += size) await insert(values.slice(offset, offset + size))
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`)
}

function safeErrorCode(error: unknown): string {
  if (error instanceof OnwayClientError) return error.code
  if (error instanceof Error && /^ONWAY_[A-Z_]+$/.test(error.message)) return error.message
  return "ONWAY_SYNC_FAILED"
}

export async function syncOnway(options: SyncOnwayOptions = {}): Promise<SyncOnwayResult> {
  const config = await readOnwayConfig()
  if (!config.hasCredentials) throw new OnwayClientError("ONWAY_CREDENTIALS_REQUIRED")

  const runId = `gpsrun-${nanoid()}`
  await db.insert(fleetGpsSyncRuns).values({
    id: runId,
    trigger: options.trigger ?? (options.actorUserId ? "manual" : "cron"),
    actorUserId: options.actorUserId,
  })

  try {
    const now = options.now ?? new Date()
    const window = historyWindow(options, now)
    const telemetry = await fetchOnwayTelemetry(
      { username: config.username, password: config.password },
      window ? { includeHistory: true, historyFrom: window.from, historyTo: window.to } : { includeHistory: false },
    )
    const snapshot = telemetry.snapshot
    const vehicles = await db.select({
      id: fuelVehicles.id,
      plate: fuelVehicles.plate,
      worksiteId: fuelVehicles.worksiteId,
      meterType: fuelVehicles.meterType,
    }).from(fuelVehicles)
    const reconciliation = reconcileOnwayDevices(snapshot.devices, vehicles)
    const matchByDevice = new Map(reconciliation.matched.map((row) => [row.device.externalDeviceId, row]))
    const detailsByDevice = new Map(telemetry.details.map((detail) => [detail.deviceId, detail]))
    let driverMappings = new Map<string, { id: string; workerId: string }>()
    try {
      driverMappings = await resolveOnwayDriverMappings(
        telemetry.details.flatMap((detail) => detail.driverExternalId ? [detail.driverExternalId] : []),
      )
    } catch {
      // Un keyring ausente o una identidad malformada no debe detener la flota.
      logger.warn("[flota/onway] no se pudieron resolver conductores", { code: "ONWAY_DRIVER_MAPPING_UNAVAILABLE" })
    }
    const driverMappingIdForDevice = (externalDeviceId: string) => {
      const externalId = detailsByDevice.get(externalDeviceId)?.driverExternalId
      return externalId ? driverMappings.get(externalId)?.id ?? null : null
    }
    const observedAt = now.toISOString()
    const updatedAt = observedAt

    await db.transaction(async (tx) => {
      for (const device of snapshot.devices) {
        const match = matchByDevice.get(device.externalDeviceId)
        const detail = detailsByDevice.get(device.externalDeviceId)
        const values = {
          provider: "onway" as const,
          externalDeviceId: device.externalDeviceId,
          externalGroupId: device.groupId,
          vehicleId: match?.vehicleId ?? null,
          worksiteId: match?.worksiteId ?? null,
          sourcePlate: device.sourcePlate,
          normalizedPlate: device.normalizedPlate,
          latitude: device.latitude,
          longitude: device.longitude,
          speedKph: device.speedKph,
          headingDegrees: device.headingDegrees,
          ignition: device.ignition,
          sourceStatus: device.sourceStatus,
          gpsReportedAt: detail?.gpsReportedAt ?? null,
          gprsReportedAt: detail?.gprsReportedAt ?? null,
          gpsStatus: detail?.gpsStatus ?? null,
          gprsStatus: detail?.gprsStatus ?? null,
          movementState: detail?.movementState ?? null,
          odometer: detail?.odometer ?? null,
          hourMeter: detail?.hourMeter ?? null,
          internalBatteryLevel: detail?.internalBatteryLevel ?? null,
          externalPowerVolts: detail?.externalPowerVolts ?? null,
          engineRpm: detail?.engineRpm ?? null,
          coolantTemperature: detail?.coolantTemperature ?? null,
          fuelLevel: detail?.fuelLevel ?? null,
          temperature1: detail?.temperature1 ?? null,
          humidity1: detail?.humidity1 ?? null,
          driverMappingId: driverMappingIdForDevice(device.externalDeviceId),
          observedAt,
          syncRunId: runId,
          updatedAt,
        }
        await tx.insert(fleetGpsLatestPositions)
          .values({ id: `gpspos-${nanoid()}`, ...values })
          .onConflictDoUpdate({
            target: [fleetGpsLatestPositions.provider, fleetGpsLatestPositions.externalDeviceId],
            set: values,
          })
      }

      const meters = reconciliation.matched.flatMap((match) => {
        const detail = detailsByDevice.get(match.device.externalDeviceId)
        const vehicle = vehicles.find((row) => row.id === match.vehicleId)
        const occurredAt = detail?.gpsReportedAt ?? observedAt
        return detail && vehicle ? [telemetryMeterReading({
          plate: vehicle.plate,
          externalDeviceId: match.device.externalDeviceId,
          occurredAt,
          meterType: vehicle.meterType,
          odometer: detail.odometer,
          hourMeter: detail.hourMeter,
        })].filter((reading): reading is ParsedMeterReading => reading !== null) : []
      })
      await saveMeterReadings(tx, "gps_onway", meters, (plate) => {
        const vehicle = vehicles.find((row) => row.plate.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() === plate)
        return vehicle ? { id: vehicle.id, meterType: vehicle.meterType } : undefined
      })

      const alerts = telemetry.alerts.flatMap((alert) => {
        const match = alert.externalDeviceId ? matchByDevice.get(alert.externalDeviceId) : undefined
        return match ? [{
          id: `gpsalert-${nanoid()}`,
          provider: "onway" as const,
          externalDeviceId: alert.externalDeviceId!,
          externalEventKey: alert.externalEventKey,
          vehicleId: match.vehicleId,
          worksiteId: match.worksiteId,
          driverMappingId: driverMappingIdForDevice(match.device.externalDeviceId),
          alertType: alert.alertType,
          category: "unknown",
          title: alert.title,
          priority: alert.priority,
          occurredAt: alert.occurredAt,
          latitude: alert.latitude,
          longitude: alert.longitude,
          speedKph: alert.speedKph,
          updatedAt,
        }] : []
      })
      await insertInBatches(alerts, 500, async (batch) => {
        await tx.insert(fleetGpsAlerts).values(batch).onConflictDoUpdate({
          target: [fleetGpsAlerts.provider, fleetGpsAlerts.externalDeviceId, fleetGpsAlerts.externalEventKey],
          set: {
            title: sqlExcluded("title"), priority: sqlExcluded("priority"), occurredAt: sqlExcluded("occurred_at"),
            latitude: sqlExcluded("latitude"), longitude: sqlExcluded("longitude"), speedKph: sqlExcluded("speed_kph"), updatedAt,
          },
        })
      })
      const alertTypes = [...new Map(telemetry.alerts.map((alert) => [alert.alertType, alert])).values()].map((alert) => ({
        id: `gpsalerttype-${nanoid()}`,
        provider: "onway" as const,
        alertType: alert.alertType,
        latestTitle: alert.title,
        firstSeenAt: alert.occurredAt,
        lastSeenAt: alert.occurredAt,
        updatedAt,
      }))
      await insertInBatches(alertTypes, 500, async (batch) => {
        await tx.insert(fleetGpsAlertTypes).values(batch).onConflictDoUpdate({
          target: [fleetGpsAlertTypes.provider, fleetGpsAlertTypes.alertType],
          set: { latestTitle: sqlExcluded("latest_title"), lastSeenAt: sqlExcluded("last_seen_at"), updatedAt },
        })
      })

      const history = reconciliation.matched.flatMap((match) => (telemetry.historyByDeviceId.get(match.device.externalDeviceId) ?? []).map((point) => ({
        id: `gpspoint-${nanoid()}`,
        provider: "onway" as const,
        externalDeviceId: match.device.externalDeviceId,
        externalPointKey: `${point.occurredAt}:${point.sourceSequence}`,
        vehicleId: match.vehicleId,
        worksiteId: match.worksiteId,
        driverMappingId: driverMappingIdForDevice(match.device.externalDeviceId),
        occurredAt: point.occurredAt,
        latitude: point.latitude,
        longitude: point.longitude,
        speedKph: point.speedKph,
        headingDegrees: point.headingDegrees,
        ignition: point.ignition,
      })))
      await insertInBatches(history, 500, async (batch) => {
        await tx.insert(fleetGpsPositionHistory).values(batch).onConflictDoNothing()
      })

      const trips = reconciliation.matched.flatMap((match) => (telemetry.tripsByDeviceId.get(match.device.externalDeviceId) ?? []).map((trip) => ({
        id: `gpstrip-${nanoid()}`,
        provider: "onway" as const,
        externalDeviceId: match.device.externalDeviceId,
        externalTripKey: `${trip.externalTripKey}:${trip.startedAt}`,
        vehicleId: match.vehicleId,
        worksiteId: match.worksiteId,
        driverMappingId: driverMappingIdForDevice(match.device.externalDeviceId),
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        distanceKm: trip.distanceKm,
        idleDuration: trip.idleDuration,
        movementDuration: trip.movementDuration,
        travelDuration: trip.travelDuration,
        beginOdometer: trip.beginOdometer,
        endOdometer: trip.endOdometer,
        updatedAt,
      })))
      await insertInBatches(trips, 500, async (batch) => {
        await tx.insert(fleetGpsTrips).values(batch).onConflictDoUpdate({
          target: [fleetGpsTrips.provider, fleetGpsTrips.externalDeviceId, fleetGpsTrips.externalTripKey],
          set: {
            endedAt: sqlExcluded("ended_at"), distanceKm: sqlExcluded("distance_km"), idleDuration: sqlExcluded("idle_duration"),
            movementDuration: sqlExcluded("movement_duration"), travelDuration: sqlExcluded("travel_duration"),
            beginOdometer: sqlExcluded("begin_odometer"), endOdometer: sqlExcluded("end_odometer"), updatedAt,
          },
        })
      })

      await tx.update(fleetGpsSyncRuns).set({
        status: snapshot.rejected.length > 0 || reconciliation.unmatched.length > 0 || telemetry.warnings.length > 0 ? "partial" : "success",
        devicesReceived: snapshot.devices.length + snapshot.rejected.length,
        devicesAccepted: reconciliation.matched.length,
        devicesRejected: snapshot.rejected.length,
        devicesUnmatched: reconciliation.unmatched.length,
        alertsReceived: alerts.length,
        pointsReceived: history.length,
        tripsReceived: trips.length,
        finishedAt: observedAt,
      }).where(eq(fleetGpsSyncRuns.id, runId))
    })

    // Las reglas se evalúan después de persistir: la clave externa ya deduplica
    // el evento y las reglas iniciales están desactivadas hasta revisión humana.
    await applyOnwayAlertRules()

    return {
      runId,
      received: snapshot.devices.length + snapshot.rejected.length,
      matched: reconciliation.matched.length,
      rejected: snapshot.rejected.length,
      unmatched: reconciliation.unmatched.length,
      unmatchedPlates: reconciliation.unmatched.map((device) => device.sourcePlate).sort(),
      observedAt,
      alerts: telemetry.alerts.length,
      points: [...telemetry.historyByDeviceId.values()].reduce((total, points) => total + points.length, 0),
      trips: [...telemetry.tripsByDeviceId.values()].reduce((total, trips) => total + trips.length, 0),
      warnings: telemetry.warnings,
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    await db.update(fleetGpsSyncRuns).set({
      status: "failed",
      errorCode: safeErrorCode(error),
      finishedAt,
    }).where(eq(fleetGpsSyncRuns.id, runId)).catch(() => undefined)
    throw new OnwayClientError(
      error instanceof OnwayClientError ? error.code : "ONWAY_SYNC_FAILED",
    )
  }
}
