import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Estimación de la próxima mantención con una lectura más nueva que la oficial
 * (GPS o horómetro de Cat vía VisionLink), contra Postgres de verdad.
 *
 * Regresión: `gpsEstimateApplies` exigía `!row.isActive`, así que sólo los
 * equipos RETIRADOS recibían estimación y ningún activo la tenía.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { createSchedule } = await import("@/lib/services/mantencion/schedules")
const { loadFleet } = await import("@/lib/services/mantencion/fleet")

const actor = { userId: "u-gps-est", email: "gps-est@example.test" }
const WS = "ws-gps-est"
const TYPE = "t-gps-est-hr"
const BRAND = "b-gps-est"
const OFFICIAL = { reading: 1000, date: "2026-11-01" }

const V = {
  visionlink: "v-est-vl", gpsOnly: "v-est-gps", gpsNewer: "v-est-gps-newer", retired: "v-est-retired",
  lower: "v-est-lower", noPlausible: "v-est-implausible",
} as const

let seq = 0
async function addVehicle(id: string, scheduleId: string, options: { isActive?: boolean } = {}) {
  seq++
  await testDb.insert(schema.fuelVehicles).values({
    id, plate: `GE-${seq}`, code: `GE-${seq}`, type: "gps-est-hr", equipmentTypeId: TYPE, worksiteId: WS, isActive: options.isActive ?? true,
  })
  await testDb.insert(schema.mantEquipmentProfiles).values({
    vehicleId: id, brandId: BRAND, scheduleId, initialReading: OFFICIAL.reading, initialReadingDate: OFFICIAL.date,
  })
}

async function addVisionLink(vehicleId: string, value: number, day: string) {
  await testDb.insert(schema.fuelMeterReadings).values({
    id: `ml-${vehicleId}-${day}`, vehicleId, plate: `PL-${vehicleId}`, source: "visionlink_api", sourceRef: `visionlink:${vehicleId}:${day}`,
    occurredAt: `${day}T23:59:59-03:00`, meterType: "hour_meter", value,
  })
}

async function addGps(vehicleId: string, hourMeter: number, reportedAt: string) {
  await testDb.insert(schema.fleetGpsLatestPositions).values({
    id: `gp-${vehicleId}`, provider: "wialon", externalDeviceId: `dev-${vehicleId}`, externalGroupId: "g", vehicleId, worksiteId: WS,
    sourcePlate: `PL-${vehicleId}`, normalizedPlate: `PL${vehicleId}`, latitude: -37, longitude: -72, speedKph: 0, headingDegrees: 0,
    ignition: false, hourMeter, gpsReportedAt: reportedAt, metersReportedAt: reportedAt, observedAt: reportedAt, syncRunId: "run-gps-est",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Teno", code: "FN-GPE", isActive: true })
  await testDb.insert(schema.fuelEquipmentTypes).values({
    id: TYPE, slug: "gps-est-hr", name: "Excavadora", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour",
  })
  await testDb.insert(schema.mantBrands).values({ id: BRAND, name: "Cat", nameKey: "cat" })
  await testDb.insert(schema.fleetGpsSyncRuns).values({ id: "run-gps-est", provider: "wialon", trigger: "manual", status: "success" })

  const created = await createSchedule(actor, { name: "Pauta horas", unit: "h", intervals: [250, 500], copyFromId: null })
  if (!created.ok) throw new Error("No se pudo crear la pauta del fixture")
  const scheduleId = created.data.id

  await addVehicle(V.visionlink, scheduleId)
  await addVisionLink(V.visionlink, 1040, "2026-11-08")
  await addGps(V.visionlink, 1030, "2026-11-06T15:00:00.000Z")

  await addVehicle(V.gpsOnly, scheduleId)
  await addGps(V.gpsOnly, 1020, "2026-11-05T15:00:00.000Z")

  await addVehicle(V.gpsNewer, scheduleId)
  await addVisionLink(V.gpsNewer, 1030, "2026-11-04")
  await addGps(V.gpsNewer, 1050, "2026-11-08T15:00:00.000Z")

  await addVehicle(V.retired, scheduleId, { isActive: false })
  await addVisionLink(V.retired, 1040, "2026-11-08")
  await addGps(V.retired, 1030, "2026-11-06T15:00:00.000Z")

  await addVehicle(V.lower, scheduleId)
  await addVisionLink(V.lower, 900, "2026-11-08")

  await addVehicle(V.noPlausible, scheduleId)
  await addVisionLink(V.noPlausible, 5000, "2026-11-08")
})

describe("estimación de mantención con lectura más nueva que la oficial", () => {
  it("un equipo ACTIVO con GPS más nuevo y plausible recibe estimación (regresión de !isActive)", async () => {
    const rows = await loadFleet({ scope: "all", includeGpsEstimate: true })
    const row = rows.find((item) => item.vehicleId === V.gpsOnly)!
    expect(row.gpsStatus).not.toBeNull()
    expect(row).toMatchObject({ gpsReading: 1020, gpsReadingSource: "gps" })
  })

  it("con VisionLink más nuevo que la oficial y que el GPS, la estimación usa VisionLink", async () => {
    const row = (await loadFleet({ scope: "all", includeGpsEstimate: true })).find((item) => item.vehicleId === V.visionlink)!
    expect(row).toMatchObject({ gpsReading: 1040, gpsReadingSource: "visionlink" })
    expect(row.gpsStatus?.currentReading).toMatchObject({ value: 1040, date: "2026-11-08", source: "VisionLink" })
  })

  it("con el GPS más nuevo que VisionLink gana el GPS", async () => {
    const row = (await loadFleet({ scope: "all", includeGpsEstimate: true })).find((item) => item.vehicleId === V.gpsNewer)!
    expect(row).toMatchObject({ gpsReading: 1050, gpsReadingSource: "gps" })
  })

  it("un equipo retirado, una lectura menor que la oficial o un avance imposible no se estiman", async () => {
    const rows = await loadFleet({ scope: "all", includeRetired: true, includeGpsEstimate: true })
    for (const id of [V.retired, V.lower, V.noPlausible]) {
      expect(rows.find((item) => item.vehicleId === id)).toMatchObject({ gpsStatus: null, gpsReading: null, gpsReadingAt: null, gpsReadingSource: null })
    }
  })

  it("sin pedir la estimación no hay ninguna", async () => {
    const rows = await loadFleet({ scope: "all" })
    expect(rows.every((row) => row.gpsStatus === null && row.gpsReadingSource === null)).toBe(true)
  })
})
