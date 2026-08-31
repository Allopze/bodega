import { createHash } from "node:crypto"

const MAX_RECORDS = 20_000
const MAX_TEXT_LENGTH = 160

export interface OnwayDeviceTelemetry {
  deviceId: string
  gpsReportedAt: string | null
  gprsReportedAt: string | null
  gpsStatus: string | null
  gprsStatus: string | null
  movementState: string | null
  odometer: number | null
  hourMeter: number | null
  internalBatteryLevel: number | null
  externalPowerVolts: number | null
  engineRpm: number | null
  coolantTemperature: number | null
  fuelLevel: number | null
  temperature1: number | null
  humidity1: number | null
  driverExternalId: string | null
  driverDisplayName: string | null
}

export interface OnwayAlertSnapshot {
  externalDeviceId: string | null
  externalEventKey: string
  alertType: string
  title: string
  priority: string | null
  occurredAt: string
  latitude: number | null
  longitude: number | null
  speedKph: number | null
}

export interface OnwayHistoryPoint {
  sourceSequence: string
  occurredAt: string
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number | null
  ignition: boolean | null
}

export interface OnwayTripSnapshot {
  externalTripKey: string
  startedAt: string
  endedAt: string
  distanceKm: number
  idleDuration: string | null
  movementDuration: string | null
  travelDuration: string | null
  beginOdometer: number | null
  endOdometer: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function boundedText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function optionalNumber(value: unknown, min: number, max: number): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value >= min && value <= max ? value : "invalid"
}

function valueOrNull(value: number | null | "invalid"): number | null {
  if (value === "invalid") throw new Error("ONWAY_TELEMETRY_INVALID")
  return value
}

function coordinates(row: Record<string, unknown>): { latitude: number | null; longitude: number | null } | null {
  const latitude = optionalNumber(row.latitude, -90, 90)
  const longitude = optionalNumber(row.longitude, -180, 180)
  if (latitude === "invalid" || longitude === "invalid") return null
  if ((latitude === null) !== (longitude === null)) return null
  return { latitude, longitude }
}

function externalEventKey(row: Record<string, unknown>, alertType: string, occurredAt: string, latitude: number | null, longitude: number | null): string {
  const explicit = boundedText(row.message_key, 200)
  if (explicit) return explicit
  const deviceId = boundedText(row.unit_id, 80) ?? boundedText(row.device_id, 80) ?? "unknown"
  return createHash("sha256")
    .update([deviceId, alertType, occurredAt, latitude ?? "", longitude ?? ""].join("|"))
    .digest("hex")
}

export function parseOnwayDeviceDetail(input: unknown): OnwayDeviceTelemetry | null {
  if (!isRecord(input)) return null
  const deviceId = typeof input.device_id === "number" && Number.isInteger(input.device_id) && input.device_id > 0
    ? String(input.device_id)
    : null
  if (!deviceId) return null

  try {
    return {
      deviceId,
      gpsReportedAt: isoInstant(input.gps_message_time),
      gprsReportedAt: isoInstant(input.gprs_message_time),
      gpsStatus: boundedText(input.gps_status, 80),
      gprsStatus: boundedText(input.gprs_status, 80),
      movementState: boundedText(input.movement_state, 80),
      odometer: valueOrNull(optionalNumber(input.odometer, 0, 9_999_999)),
      hourMeter: valueOrNull(optionalNumber(input.total_ignition_time_calculate ?? input.currentHourMeter, 0, 9_999_999)),
      internalBatteryLevel: valueOrNull(optionalNumber(input.internal_battery_level, 0, 100)),
      externalPowerVolts: valueOrNull(optionalNumber(input.external_power_vcc ?? input.externalPowerSupplyLevel, 0, 100)),
      engineRpm: valueOrNull(optionalNumber(input.engineRpm, 0, 20_000)),
      coolantTemperature: valueOrNull(optionalNumber(input.engineCoolantTemperature, -100, 300)),
      fuelLevel: valueOrNull(optionalNumber(input.fuelLevelInput, 0, 100)),
      temperature1: valueOrNull(optionalNumber(input.temperature_1, -100, 200)),
      humidity1: valueOrNull(optionalNumber(input.humidity_1, 0, 100)),
      driverExternalId: boundedText(input.authentication_id, 160),
      driverDisplayName: boundedText(input.driver_name_with_key, 160),
    }
  } catch {
    return null
  }
}

export function parseOnwayAlertHistory(input: unknown): OnwayAlertSnapshot | null {
  if (!isRecord(input)) return null
  const alertType = typeof input.alert_id === "number" && Number.isInteger(input.alert_id) && input.alert_id >= 0
    ? String(input.alert_id)
    : boundedText(input.alert_id, 80)
  const title = boundedText(input.alert_description ?? input.message, 240)
  const occurredAt = isoInstant(input.generate_time ?? input.entry_time)
  if (!alertType || !title || !occurredAt) return null
  const point = coordinates(input)
  if (!point) return null
  const speedKph = optionalNumber(input.speed, 0, 400)
  if (speedKph === "invalid") return null
  return {
    externalDeviceId: typeof input.unit_id === "number" && Number.isInteger(input.unit_id) && input.unit_id > 0
      ? String(input.unit_id)
      : typeof input.device_id === "number" && Number.isInteger(input.device_id) && input.device_id > 0
        ? String(input.device_id)
        : null,
    externalEventKey: externalEventKey(input, alertType, occurredAt, point.latitude, point.longitude),
    alertType,
    title,
    priority: boundedText(input.priority, 32),
    occurredAt,
    latitude: point.latitude,
    longitude: point.longitude,
    speedKph,
  }
}

export function parseOnwayHistory(input: unknown): OnwayHistoryPoint[] {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) return []
  const points: OnwayHistoryPoint[] = []
  for (const value of input) {
    if (!isRecord(value)) continue
    const sequence = typeof value.sequence === "number" && Number.isInteger(value.sequence)
      ? String(value.sequence)
      : boundedText(value.sequence, 80)
    const occurredAt = isoInstant(value.generate_time)
    const point = coordinates(value)
    const speedKph = optionalNumber(value.speed, 0, 400)
    const headingDegrees = optionalNumber(value.directionHeading ?? value.heading, 0, 359.999)
    if (!sequence || !occurredAt || !point || point.latitude === null || point.longitude === null || speedKph === "invalid" || speedKph === null || headingDegrees === "invalid") continue
    points.push({
      sourceSequence: sequence,
      occurredAt,
      latitude: point.latitude,
      longitude: point.longitude,
      speedKph,
      headingDegrees,
      ignition: typeof value.ignition === "boolean" ? value.ignition : null,
    })
  }
  return points
}

export function parseOnwayTrips(input: unknown): OnwayTripSnapshot[] {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) return []
  const trips: OnwayTripSnapshot[] = []
  for (const value of input) {
    if (!isRecord(value)) continue
    const externalTripKey = typeof value.row === "number" && Number.isInteger(value.row)
      ? String(value.row)
      : boundedText(value.row, 80)
    const startedAt = isoInstant(value.begin_message_time)
    const endedAt = isoInstant(value.end_message_time)
    const distanceKm = optionalNumber(value.distance, 0, 100_000)
    const beginOdometer = optionalNumber(value.begin_odometer, 0, 9_999_999)
    const endOdometer = optionalNumber(value.end_odometer, 0, 9_999_999)
    if (!externalTripKey || !startedAt || !endedAt || startedAt >= endedAt || distanceKm === null || distanceKm === "invalid" || beginOdometer === "invalid" || endOdometer === "invalid") continue
    trips.push({
      externalTripKey,
      startedAt,
      endedAt,
      distanceKm,
      idleDuration: boundedText(value.no_movement_length_str, 32),
      movementDuration: boundedText(value.movement_length_str, 32),
      travelDuration: boundedText(value.travel_length_str, 32),
      beginOdometer,
      endOdometer,
    })
  }
  return trips
}
