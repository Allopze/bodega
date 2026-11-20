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

function localizedText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  const direct = boundedText(value, maxLength)
  if (direct) return direct
  if (!isRecord(value)) return null
  return boundedText(value.es, maxLength)
    ?? boundedText(value["es-CL"], maxLength)
    ?? Object.values(value).map((item) => boundedText(item, maxLength)).find((item) => item !== null)
    ?? null
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  const dotNetDate = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(trimmed)
  if (dotNetDate) {
    const milliseconds = Number(dotNetDate[1])
    if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8_640_000_000_000_000) return null
    return new Date(milliseconds).toISOString()
  }
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

/**
 * `devices/quick/history` entrega `generate_time` sin zona (`2026-11-18T12:05:22`),
 * expresado en el `timeZone` de la consulta. El cliente pide `timeZone: "0"`, así
 * que una hora sin zona es UTC; `Date.parse` la leería en la zona del proceso.
 */
function utcInstant(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value.trim())) {
    return isoInstant(`${value.trim()}Z`)
  }
  return isoInstant(value)
}

/** Desfase horario (horas) del usuario del portal; ver `wallClockInstant`. */
export interface OnwayWallClockOptions {
  wallClockOffsetHours?: number
}

/**
 * El portal escribe `/Date(ms)/` (detalle, alertas, viajes) con la hora del RELOJ
 * en el desfase de su usuario como si fuera UTC. Verificado 2026-11-19 con el
 * usuario en `-4`: el reporte GPS más nuevo decía 22:06Z a las 02:06Z, y los
 * viajes calzan con el odómetro del historial sólo sumando 4 h. Sin desfase
 * conocido se lee tal cual; una fecha que ya trae su zona no se corrige.
 */
function wallClockInstant(value: unknown, wallClockOffsetHours: number | undefined): string | null {
  if (typeof value === "string" && wallClockOffsetHours !== undefined) {
    const dotNetDate = /^\/Date\((-?\d+)\)\/$/.exec(value.trim())
    if (dotNetDate) return isoInstant(`/Date(${Number(dotNetDate[1]) - wallClockOffsetHours * 3_600_000})/`)
  }
  return isoInstant(value)
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

function optionalSensorValue(value: unknown, min: number, max: number): number | null {
  const parsed = optionalNumber(value, min, max)
  return parsed === "invalid" ? null : parsed
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

export function parseOnwayDeviceDetail(input: unknown, options: OnwayWallClockOptions = {}): OnwayDeviceTelemetry | null {
  if (!isRecord(input)) return null
  const deviceId = typeof input.device_id === "number" && Number.isInteger(input.device_id) && input.device_id > 0
    ? String(input.device_id)
    : null
  if (!deviceId) return null

  try {
    return {
      deviceId,
      gpsReportedAt: wallClockInstant(input.gps_message_time, options.wallClockOffsetHours),
      gprsReportedAt: wallClockInstant(input.gprs_message_time, options.wallClockOffsetHours),
      gpsStatus: boundedText(input.gps_status, 80),
      gprsStatus: boundedText(input.gprs_status, 80),
      movementState: boundedText(input.movement_state, 80),
      odometer: valueOrNull(optionalNumber(input.odometer, 0, 9_999_999)),
      hourMeter: valueOrNull(optionalNumber(input.total_ignition_time_calculate ?? input.currentHourMeter, 0, 9_999_999)),
      internalBatteryLevel: optionalSensorValue(input.internal_battery_level, 0, 100),
      externalPowerVolts: optionalSensorValue(input.external_power_vcc ?? input.externalPowerSupplyLevel, 0, 100),
      engineRpm: optionalSensorValue(input.engineRpm, 0, 20_000),
      coolantTemperature: optionalSensorValue(input.engineCoolantTemperature, -100, 300),
      fuelLevel: optionalSensorValue(input.fuelLevelInput, 0, 100),
      temperature1: optionalSensorValue(input.temperature_1, -100, 200),
      humidity1: optionalSensorValue(input.humidity_1, 0, 100),
      driverExternalId: boundedText(input.authentication_id, 160),
      driverDisplayName: boundedText(input.driver_name_with_key, 160),
    }
  } catch {
    return null
  }
}

export function parseOnwayAlertHistory(input: unknown, options: OnwayWallClockOptions = {}): OnwayAlertSnapshot | null {
  if (!isRecord(input)) return null
  const alertType = typeof input.alert_id === "number" && Number.isInteger(input.alert_id) && input.alert_id >= 0
    ? String(input.alert_id)
    : boundedText(input.alert_id, 80)
  const title = localizedText(input.alert_description, 240)
    ?? localizedText(input.message, 240)
    ?? localizedText(input.alert_string, 240)
  // La clave se calcula con la hora tal como la entrega el portal, para que una
  // alerta guardada antes de corregir el desfase se actualice y no se duplique.
  const portalInstant = isoInstant(input.generate_time ?? input.entry_time)
  const occurredAt = wallClockInstant(input.generate_time ?? input.entry_time, options.wallClockOffsetHours)
  if (!alertType || !title || !occurredAt || !portalInstant) return null
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
    externalEventKey: externalEventKey(input, alertType, portalInstant, point.latitude, point.longitude),
    alertType,
    title,
    priority: typeof input.priority === "number" && Number.isFinite(input.priority)
      ? String(input.priority)
      : boundedText(input.priority, 32),
    occurredAt,
    latitude: point.latitude,
    longitude: point.longitude,
    speedKph,
  }
}

export function parseOnwayAlertRows(
  input: unknown,
  refs: Array<{ deviceId: string; unitId: string; imei: string | null }>,
  options: OnwayWallClockOptions = {},
): { alerts: OnwayAlertSnapshot[]; incomplete: boolean } {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) return { alerts: [], incomplete: true }
  const deviceIdByImei = new Map(refs.flatMap((ref) => ref.imei ? [[ref.imei, ref.deviceId] as const] : []))
  const deviceIdByUnitId = new Map(refs.map((ref) => [ref.unitId, ref.deviceId]))
  const alerts: OnwayAlertSnapshot[] = []
  let incomplete = false
  for (const row of input) {
    const parsed = parseOnwayAlertHistory(row, options)
    if (!parsed) {
      incomplete = true
      continue
    }
    const sourceImei = isRecord(row) && typeof row.unit_imei === "string" ? row.unit_imei : null
    const externalDeviceId = (sourceImei ? deviceIdByImei.get(sourceImei) : undefined)
      ?? (parsed.externalDeviceId ? deviceIdByUnitId.get(parsed.externalDeviceId) ?? parsed.externalDeviceId : undefined)
    if (!externalDeviceId) {
      incomplete = true
      continue
    }
    alerts.push({ ...parsed, externalDeviceId })
  }
  return { alerts, incomplete }
}

export function parseOnwayHistory(input: unknown): OnwayHistoryPoint[] {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) return []
  const points: OnwayHistoryPoint[] = []
  for (const value of input) {
    if (!isRecord(value)) continue
    // `sequence` es la posición del punto en ESTA respuesta (1, 2, 3…): el mismo
    // punto trae otro número en la consulta siguiente, cuya ventana se solapa.
    // `message_key` identifica el mensaje y se mantiene entre consultas.
    const sequence = boundedText(value.message_key, 80) ?? (typeof value.sequence === "number" && Number.isInteger(value.sequence)
      ? String(value.sequence)
      : boundedText(value.sequence, 80))
    const occurredAt = utcInstant(value.generate_time)
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

export function parseOnwayTrips(input: unknown, options: OnwayWallClockOptions = {}): OnwayTripSnapshot[] {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) return []
  const trips: OnwayTripSnapshot[] = []
  for (const value of input) {
    if (!isRecord(value)) continue
    const startedAt = wallClockInstant(value.begin_message_time, options.wallClockOffsetHours)
    // `GetDeviceLatestTrips` trae `id: 0` en todos y `row` es la posición 1..5 en
    // la lista de últimos viajes, que corre con cada viaje nuevo: como clave, cada
    // corrida pisaba viajes distintos. Un equipo no empieza dos viajes en el mismo
    // instante, así que el inicio identifica al viaje.
    const externalTripKey = startedAt
    const endedAt = wallClockInstant(value.end_message_time, options.wallClockOffsetHours)
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
