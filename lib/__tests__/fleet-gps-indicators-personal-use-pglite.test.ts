import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Uso personal en los indicadores GPS (`/flota/indicadores`): en los días de uso
 * personal de un equipo no suman km, horas ni viajes, y quitar el período devuelve
 * las cifras de siempre. Los registros crudos (lecturas, viajes) siguen en la base.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getGpsUsageIndicators, getGpsDrivingIndicators } = await import("@/lib/services/fleet-gps-indicators")

const session = {
  user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["flota:view", "flota:view_gps_history", "combustibles:view"] },
  expires: "2099-01-01",
} as unknown as Session

const period = {
  from: "2026-11-01",
  to: "2026-11-10",
  previous: { from: "2026-10-22", to: "2026-10-31" },
  granularity: "day" as const,
  chart: { from: "2026-11-01", to: "2026-11-10", granularity: "day" as const },
}

const at = (day: string) => `${day}T15:00:00.000Z`
let seq = 0
const reading = (vehicleId: string, source: string, meterType: string, day: string, value: number) => ({
  id: `mr-pu-${++seq}`, vehicleId, plate: "AA0001", source, sourceRef: `ref-pu-${seq}`, occurredAt: at(day), meterType, value,
})

async function markPersonalUse(vehicleId: string, startedOn: string, endedOn: string | null) {
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: `pu-gps-${++seq}`, vehicleId, startedOn, endedOn })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.fuelMeterReadings).values([
    // vA: odómetro Wialon. 31/10 +30 (período anterior); 01/11 +70, 02/11 +40, 03/11 +20.
    reading(IDS.vA, "gps_wialon", "odometer", "2026-10-30", 900),
    reading(IDS.vA, "gps_wialon", "odometer", "2026-10-31", 930),
    reading(IDS.vA, "gps_wialon", "odometer", "2026-11-01", 1_000),
    reading(IDS.vA, "gps_wialon", "odometer", "2026-11-02", 1_040),
    reading(IDS.vA, "gps_wialon", "odometer", "2026-11-03", 1_060),
    // vB: horómetro VisionLink 02/11 → 03/11 +8 y 03/11 → 06/11 +12 (un par de tres días).
    reading(IDS.vB, "visionlink_api", "hour_meter", "2026-11-02", 100),
    reading(IDS.vB, "visionlink_api", "hour_meter", "2026-11-03", 108),
    reading(IDS.vB, "visionlink_api", "hour_meter", "2026-11-06", 120),
  ])

  const trip = (key: string, vehicleId: string, worksiteId: string, startedAt: string, km: number) => ({
    id: `trip-pu-${key}`, provider: "onway", externalDeviceId: `dev-${key}`, externalTripKey: key, vehicleId, worksiteId,
    startedAt, endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(), distanceKm: km,
  })
  await testDb.insert(schema.fleetGpsTrips).values([
    trip("a1", IDS.vA, IDS.wsA, "2026-11-03T15:00:00.000Z", 10),
    trip("a2", IDS.vA, IDS.wsA, "2026-11-03T15:30:00.000Z", 20),
    // 23:30 del 3 de noviembre en Chile (UTC-3): es del día 3, no del 4.
    trip("a3", IDS.vA, IDS.wsA, "2026-11-04T02:30:00.000Z", 6),
    trip("a4", IDS.vA, IDS.wsA, "2026-11-05T15:00:00.000Z", 4),
    trip("b1", IDS.vB, IDS.wsB, "2026-11-04T15:00:00.000Z", 5),
  ])
})

afterEach(async () => {
  await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
})

describe("uso GPS (km y horas)", () => {
  it("el avance de los días de uso personal no suma; el resto del equipo y de la flota sigue igual", async () => {
    const before = await getGpsUsageIndicators(session, period)
    expect(before.km.current).toBe(130)
    await markPersonalUse(IDS.vA, "2026-11-02", "2026-11-02")
    const after = await getGpsUsageIndicators(session, period)
    // 02/11 (+40) sale; 01/11 (+70) y 03/11 (+20) quedan.
    expect(after.km.current).toBe(90)
    expect(after.km.previous).toBe(30)
    expect(after.buckets.find((bucket) => bucket.key === "2026-11-02")?.km).toBe(0)
    expect(after.buckets.find((bucket) => bucket.key === "2026-11-01")?.km).toBe(70)
    expect(after.topByKm.map((row) => [row.vehicleId, row.km])).toEqual([[IDS.vA, 90]])
    expect(after.byWorksite.find((row) => row.worksiteId === IDS.wsA)?.km).toBe(90)
    expect(after.hours.current).toBe(before.hours.current)
  })

  it("un par que recorre días de uso personal sin tener lectura en ellos tampoco suma", async () => {
    await markPersonalUse(IDS.vB, "2026-11-04", "2026-11-05")
    const data = await getGpsUsageIndicators(session, period)
    // 03/11 → 06/11 (+12) recorre los días 4, 5 y 6: toca el período y sale. Queda 02 → 03 (+8).
    expect(data.hours.current).toBe(8)
  })

  it("un período abierto excluye desde su inicio hasta hoy", async () => {
    await markPersonalUse(IDS.vA, "2026-11-02", null)
    const data = await getGpsUsageIndicators(session, period)
    expect(data.km.current).toBe(70)
  })

  it("quitar el período devuelve las cifras de siempre", async () => {
    await markPersonalUse(IDS.vA, "2026-11-02", "2026-11-02")
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
    const data = await getGpsUsageIndicators(session, period)
    expect(data.km.current).toBe(130)
    expect(data.hours.current).toBe(20)
  })
})

describe("viajes (conducción)", () => {
  it("los viajes de los días de uso personal no suman, en hora de Chile", async () => {
    const before = await getGpsDrivingIndicators(session, period)
    expect(before.trips).toMatchObject({ current: 5, km: 45 })
    await markPersonalUse(IDS.vA, "2026-11-03", "2026-11-03")
    const after = await getGpsDrivingIndicators(session, period)
    // Salen a1, a2 y a3 (el de las 23:30 del 3 es del 3); quedan a4 y b1.
    expect(after.trips).toMatchObject({ current: 2, km: 9 })
    expect(after.tripBuckets.find((bucket) => bucket.key === "2026-11-03")).toMatchObject({ trips: 0, km: 0 })
  })

  it("los registros crudos siguen en la base", async () => {
    await markPersonalUse(IDS.vA, "2026-11-03", "2026-11-03")
    const raw = await testDb.select({ id: schema.fleetGpsTrips.id }).from(schema.fleetGpsTrips).where(eq(schema.fleetGpsTrips.vehicleId, IDS.vA))
    expect(raw).toHaveLength(4)
  })
})

describe("alertas GPS (excesos de velocidad)", () => {
  const alert = (key: string, vehicleId: string, worksiteId: string, occurredAt: string) => ({
    id: `alert-pu-${key}`, provider: "onway", externalDeviceId: `dev-${key}`, externalEventKey: `evt-${key}`, vehicleId, worksiteId,
    alertType: "speeding", title: "Exceso de velocidad", occurredAt,
  })

  beforeAll(async () => {
    await testDb.insert(schema.fleetGpsAlerts).values([
      alert("a1", IDS.vA, IDS.wsA, "2026-11-03T15:00:00.000Z"),
      // 23:30 del 3 de noviembre en Chile (UTC-3): es del día 3, no del 4.
      alert("a2", IDS.vA, IDS.wsA, "2026-11-04T02:30:00.000Z"),
      alert("a3", IDS.vA, IDS.wsA, "2026-11-06T15:00:00.000Z"),
      alert("b1", IDS.vB, IDS.wsB, "2026-11-04T15:00:00.000Z"),
    ])
  })

  it("los excesos de los días de uso personal no entran al ranking; los de fuera sí", async () => {
    const before = await getGpsDrivingIndicators(session, period)
    expect(before.speeding.current).toBe(4)
    expect(before.topSpeeding.map((row) => [row.vehicleId, row.count])).toEqual([[IDS.vA, 3], [IDS.vB, 1]])
    await markPersonalUse(IDS.vA, "2026-11-03", "2026-11-03")
    const after = await getGpsDrivingIndicators(session, period)
    // Salen a1 y a2 (el de las 23:30 del 3 es del 3); queda a3 (día 6) y b1.
    expect(after.speeding.current).toBe(2)
    expect(after.alertTotals.speeding).toBe(2)
    expect(after.topSpeeding.map((row) => [row.vehicleId, row.count])).toEqual([[IDS.vA, 1], [IDS.vB, 1]])
  })

  it("el registro crudo de alertas sigue en la base", async () => {
    await markPersonalUse(IDS.vA, "2026-11-03", "2026-11-03")
    const raw = await testDb.select({ id: schema.fleetGpsAlerts.id }).from(schema.fleetGpsAlerts).where(eq(schema.fleetGpsAlerts.vehicleId, IDS.vA))
    expect(raw).toHaveLength(3)
  })
})
