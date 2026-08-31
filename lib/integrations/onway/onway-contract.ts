import { z } from "zod"

const MAX_DEVICES = 5_000

export interface OnwayDeviceSnapshot {
  externalDeviceId: string
  groupId: string
  sourcePlate: string
  normalizedPlate: string
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number
  ignition: boolean
  sourceStatus: string | null
}

export type OnwayRejectionReason =
  | "invalid_identity"
  | "missing_plate"
  | "invalid_coordinates"
  | "invalid_speed"
  | "invalid_heading"
  | "invalid_ignition"

export interface OnwaySnapshotResult {
  devices: OnwayDeviceSnapshot[]
  rejected: Array<{ sourceRowKey: string; reason: OnwayRejectionReason }>
}

const payloadSchema = z.object({
  is_session_alive: z.boolean(),
  devices: z.array(z.unknown()),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizePlate(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
}

export function parseOnwaySnapshot(input: unknown): OnwaySnapshotResult {
  const parsed = payloadSchema.safeParse(input)
  if (!parsed.success) throw new Error("ONWAY_PAYLOAD_INVALID")
  if (!parsed.data.is_session_alive) throw new Error("ONWAY_SESSION_EXPIRED")
  if (parsed.data.devices.length > MAX_DEVICES) throw new Error("ONWAY_PAYLOAD_TOO_LARGE")

  const devices: OnwayDeviceSnapshot[] = []
  const rejected: OnwaySnapshotResult["rejected"] = []
  const identities = new Set<string>()

  for (const [index, value] of parsed.data.devices.entries()) {
    const row = isRecord(value) ? value : {}
    const validId = typeof row.device_id === "number" && Number.isInteger(row.device_id) && row.device_id > 0
    const sourceRowKey = validId ? String(row.device_id) : `row:${index + 1}`
    if (!validId || typeof row.group_id !== "number" || !Number.isInteger(row.group_id)) {
      rejected.push({ sourceRowKey, reason: "invalid_identity" })
      continue
    }
    if (identities.has(sourceRowKey)) throw new Error("ONWAY_DUPLICATE_DEVICE")
    identities.add(sourceRowKey)

    const sourcePlate = typeof row.automotor_plate === "string" ? row.automotor_plate.trim() : ""
    const normalizedPlate = normalizePlate(sourcePlate)
    if (!normalizedPlate) {
      rejected.push({ sourceRowKey, reason: "missing_plate" })
      continue
    }
    if (
      !finiteNumber(row.latitude) || Math.abs(row.latitude) > 90
      || !finiteNumber(row.longitude) || Math.abs(row.longitude) > 180
    ) {
      rejected.push({ sourceRowKey, reason: "invalid_coordinates" })
      continue
    }
    if (!finiteNumber(row.speed) || row.speed < 0 || row.speed > 400) {
      rejected.push({ sourceRowKey, reason: "invalid_speed" })
      continue
    }
    if (!finiteNumber(row.directionHeading) || row.directionHeading < 0 || row.directionHeading >= 360) {
      rejected.push({ sourceRowKey, reason: "invalid_heading" })
      continue
    }
    if (typeof row.ignition !== "boolean") {
      rejected.push({ sourceRowKey, reason: "invalid_ignition" })
      continue
    }

    devices.push({
      externalDeviceId: sourceRowKey,
      groupId: String(row.group_id),
      sourcePlate,
      normalizedPlate,
      latitude: row.latitude,
      longitude: row.longitude,
      speedKph: row.speed,
      headingDegrees: row.directionHeading,
      ignition: row.ignition,
      sourceStatus: typeof row.active === "string" ? row.active.slice(0, 80) : null,
    })
  }

  return { devices, rejected }
}
