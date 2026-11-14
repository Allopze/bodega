import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Indicadores GPS (`/flota/indicadores`): alcance por faena y agregación sobre
 * datos reales de la base. Lo que se protege:
 * - un rol acotado a una faena sólo ve sus equipos, y elegir otra faena no amplía nada;
 * - el avance sólo usa las fuentes GPS (nunca `copec_tct`) y una fuente por medidor;
 * - los días se miden en hora de Chile: un viaje a las 23:30 del 3 no es del 4;
 * - las alertas operacionales (apagado, fin de ralentí) no se cuentan;
 * - viajes y alertas exigen `flota:view_gps_history`; el ralentí, `combustibles:view`.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getGpsUsageIndicators, getGpsDrivingIndicators, getGpsIdleIndicators } = await import("./fleet-gps-indicators")

const PERMISSIONS = ["flota:view", "flota:view_gps_history", "combustibles:view"]

function session(worksiteIds: string[] | "global", permissions: string[] = PERMISSIONS): Session {
  return {
    user: { id: IDS.user, isGlobal: worksiteIds === "global", roles: [], worksiteIds: worksiteIds === "global" ? [] : worksiteIds, permissions },
    expires: "2099-01-01",
  } as unknown as Session
}

const period = {
  from: "2026-11-01",
  to: "2026-11-10",
  previous: { from: "2026-10-22", to: "2026-10-31" },
  granularity: "day" as const,
}

const at = (day: string) => `${day}T15:00:00.000Z`
let seq = 0
const reading = (vehicleId: string, plate: string, source: string, meterType: string, day: string, value: number) => ({
  id: `mr-gps-${++seq}`, vehicleId, plate, source, sourceRef: `ref-${seq}`, occurredAt: at(day), meterType, value,
})

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.fuelMeterReadings).values([
    // vA: odómetro Wialon. Período anterior +30 (cierra el 31/10); período +70, +40, +20.
    reading(IDS.vA, "AA0001", "gps_wialon", "odometer", "2026-10-30", 900),
    reading(IDS.vA, "AA0001", "gps_wialon", "odometer", "2026-10-31", 930),
    reading(IDS.vA, "AA0001", "gps_wialon", "odometer", "2026-11-01", 1_000),
    reading(IDS.vA, "AA0001", "gps_wialon", "odometer", "2026-11-02", 1_040),
    reading(IDS.vA, "AA0001", "gps_wialon", "odometer", "2026-11-03", 1_060),
    // Copec nunca entra: un odómetro de carga con un salto enorme no debe tocar el avance.
    reading(IDS.vA, "AA0001", "copec_tct", "odometer", "2026-11-02", 500_000),
    reading(IDS.vA, "AA0001", "copec_tct", "odometer", "2026-11-03", 900_000),
    // vB (otra faena): horómetro VisionLink +8.
    reading(IDS.vB, "BB0002", "visionlink_api", "hour_meter", "2026-11-02", 100),
    reading(IDS.vB, "BB0002", "visionlink_api", "hour_meter", "2026-11-03", 108),
  ])

  await testDb.insert(schema.fleetGpsDeviceLinks).values({
    id: "link-c", provider: "wialon", externalDeviceId: "unit-c", status: "linked", vehicleId: IDS.vC,
  })

  const trip = (key: string, vehicleId: string, worksiteId: string, startedAt: string, km: number) => ({
    id: `trip-${key}`, provider: "onway", externalDeviceId: `dev-${key}`, externalTripKey: key, vehicleId, worksiteId,
    startedAt, endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(), distanceKm: km,
  })
  await testDb.insert(schema.fleetGpsTrips).values([
    trip("a1", IDS.vA, IDS.wsA, "2026-11-03T15:00:00.000Z", 10),
    trip("a2", IDS.vA, IDS.wsA, "2026-11-03T15:30:00.000Z", 20),
    // 23:30 del 3 de noviembre en Chile (UTC-3): es del día 3, no del 4.
    trip("a3", IDS.vA, IDS.wsA, "2026-11-04T02:30:00.000Z", 6),
    trip("b1", IDS.vB, IDS.wsB, "2026-11-04T15:00:00.000Z", 5),
    trip("a-prev", IDS.vA, IDS.wsA, "2026-10-28T15:00:00.000Z", 9),
  ])

  const alert = (key: string, vehicleId: string | null, worksiteId: string | null, day: string, title: string) => ({
    id: `alert-${key}`, provider: "onway", externalDeviceId: `dev-${key}`, externalEventKey: key, vehicleId, worksiteId,
    alertType: "1", title, occurredAt: at(day),
  })
  const speed = "El dispositivo KA-1 ha excedido la velocidad en segmento vial, límite de 50 km/h."
  await testDb.insert(schema.fleetGpsAlerts).values([
    alert("s1", IDS.vA, IDS.wsA, "2026-11-03", speed),
    alert("s2", IDS.vA, IDS.wsA, "2026-11-04", speed),
    alert("i1", IDS.vA, IDS.wsA, "2026-11-04", "Inicio de ralentí, dispositivo KA-1"),
    alert("i2", IDS.vA, IDS.wsA, "2026-11-04", "Fin de ralentí, dispositivo KA-1"),
    alert("o1", IDS.vA, IDS.wsA, "2026-11-05", "El vehículo KA-1 fue apagado"),
    alert("h1", IDS.vB, IDS.wsB, "2026-11-05", "El dispositivo KB-2 frenó bruscamente"),
    alert("s3", IDS.vB, IDS.wsB, "2026-11-06", speed),
    alert("sp", IDS.vA, IDS.wsA, "2026-10-25", speed),
    alert("orphan", null, null, "2026-11-05", speed),
  ])

  await testDb.insert(schema.fuelTelemetryDaily).values([
    { id: "td-a", vehicleId: IDS.vA, source: "visionlink", day: "2026-11-02", month: "2026-11", operatingHours: 8, idleHours: 2 },
    { id: "td-b", vehicleId: IDS.vB, source: "visionlink", day: "2026-11-03", month: "2026-11", operatingHours: 10, idleHours: 1 },
    { id: "td-prev", vehicleId: IDS.vA, source: "visionlink", day: "2026-10-25", month: "2026-10", operatingHours: 10, idleHours: 4 },
  ])
})

describe("getGpsUsageIndicators", () => {
  it("un rol global suma todas las faenas y sólo con fuentes GPS", async () => {
    const data = await getGpsUsageIndicators(session("global"), period)
    expect(data.km).toEqual({ current: 130, previous: 30 })
    expect(data.hours).toEqual({ current: 8, previous: 0 })
    expect(data.fleetVehicles).toBe(3)
    expect(data.linkedVehicles).toBe(3) // vA y vB por lecturas, vC por vínculo
    expect(data.vehiclesWithReadings).toBe(2)
    expect(data.vehiclesWithUse).toBe(2)
    expect(data.buckets).toHaveLength(10)
    expect(data.buckets.find((bucket) => bucket.key === "2026-11-01")).toMatchObject({ km: 70 })
    expect(data.buckets.find((bucket) => bucket.key === "2026-11-03")).toMatchObject({ km: 20, hours: 8 })
    expect(data.topByKm.map((row) => row.vehicleId)).toEqual([IDS.vA])
    expect(data.topByHours.map((row) => row.vehicleId)).toEqual([IDS.vB])
    expect(data.byWorksite.map((row) => [row.worksiteId, row.km, row.hours])).toEqual([[IDS.wsA, 130, 0], [IDS.wsB, 0, 8]])
  })

  it("un rol acotado a una faena sólo ve sus equipos", async () => {
    const data = await getGpsUsageIndicators(session([IDS.wsA]), period)
    expect(data.fleetVehicles).toBe(1)
    expect(data.km.current).toBe(130)
    expect(data.hours.current).toBe(0)
    expect(data.byWorksite.map((row) => row.worksiteId)).toEqual([IDS.wsA])
  })

  it("elegir una faena ajena al alcance devuelve cero, no esa faena", async () => {
    const data = await getGpsUsageIndicators(session([IDS.wsA]), { ...period, worksiteId: IDS.wsB })
    expect(data.fleetVehicles).toBe(0)
    expect(data.km).toEqual({ current: 0, previous: 0 })
    expect(data.topByKm).toEqual([])
  })

  it("el filtro de faena de un rol global acota la consulta", async () => {
    const data = await getGpsUsageIndicators(session("global"), { ...period, worksiteId: IDS.wsB })
    expect(data.fleetVehicles).toBe(1)
    expect(data.km.current).toBe(0)
    expect(data.hours.current).toBe(8)
  })

  it("sin flota:view no hay datos", async () => {
    await expect(getGpsUsageIndicators(session("global", []), period)).rejects.toThrow()
  })
})

describe("getGpsDrivingIndicators", () => {
  it("cuenta viajes en hora de Chile y promedia con la distancia", async () => {
    const data = await getGpsDrivingIndicators(session("global"), period)
    expect(data.trips).toEqual({ current: 4, previous: 1, km: 41 })
    const byKey = Object.fromEntries(data.tripBuckets.map((bucket) => [bucket.key, bucket]))
    expect(byKey["2026-11-03"]).toMatchObject({ trips: 3, km: 36 })
    expect(byKey["2026-11-04"]).toMatchObject({ trips: 1, km: 5 })
  })

  it("no cuenta las alertas operacionales ni las sin equipo", async () => {
    const data = await getGpsDrivingIndicators(session("global"), period)
    expect(data.alertTotals).toEqual({ speeding: 3, harsh_driving: 1, pothole: 0, idle: 1, other: 0 })
    expect(data.speeding).toEqual({ current: 3, previous: 1 })
    expect(data.topSpeeding.map((row) => [row.vehicleId, row.count])).toEqual([[IDS.vA, 2], [IDS.vB, 1]])
    expect(data.alertGranularity).toBe("week")
  })

  it("respeta el alcance de faena", async () => {
    const data = await getGpsDrivingIndicators(session([IDS.wsB]), period)
    expect(data.trips.current).toBe(1)
    expect(data.alertTotals).toEqual({ speeding: 1, harsh_driving: 1, pothole: 0, idle: 0, other: 0 })
    expect(data.topSpeeding.map((row) => row.vehicleId)).toEqual([IDS.vB])
  })

  it("exige flota:view_gps_history", async () => {
    await expect(getGpsDrivingIndicators(session("global", ["flota:view"]), period)).rejects.toThrow()
  })
})

describe("getGpsIdleIndicators", () => {
  it("el % es ralentí sobre horas de funcionamiento, con el período anterior", async () => {
    const data = await getGpsIdleIndicators(session("global"), period)
    expect(data.months).toEqual([{ key: "2026-11", workingHours: 15, idleHours: 3 }])
    expect(data.vehicles).toBe(2)
    expect(data.idlePct).toBeCloseTo((3 / 18) * 100, 6)
    expect(data.previousIdlePct).toBeCloseTo((4 / 10) * 100, 6)
  })

  it("respeta el alcance de faena", async () => {
    const data = await getGpsIdleIndicators(session([IDS.wsA]), period)
    expect(data.vehicles).toBe(1)
    expect(data.idleHours).toBe(2)
  })

  it("exige combustibles:view", async () => {
    await expect(getGpsIdleIndicators(session("global", ["flota:view", "flota:view_gps_history"]), period)).rejects.toThrow()
  })
})
