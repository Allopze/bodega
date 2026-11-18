import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import {
  IDS, filtersFor, globalSession, scopedSession, seedControlFixtures, submission,
} from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Combustible por la faena del día: un equipo trasladado a mitad de período cuenta cada
 * día en la faena donde estaba ESE día, no en la actual. Cubre la telemetría de ralentí
 * (y su comparación con las cargas), las lecturas de medidor y el mapa de calor de consumos.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const idle = await import("@/lib/combustibles/control/queries/idle")
const { getLitersPerHourComparison } = await import("@/lib/combustibles/control/queries/idle-comparison")
const { getMeterRateSeries } = await import("@/lib/combustibles/control/queries/meter-rates")
const { getWorksiteEquipmentMatrix } = await import("@/lib/combustibles/consumption-dashboard")

const V = { tel: "veh-fsc-tel", mand: "veh-fsc-mand", km: "veh-fsc-km", heat: "veh-fsc-heat" } as const
const DAYS = Array.from({ length: 11 }, (_, i) => `2026-11-${String(10 + i)}`) // 10..20
const NOV = { monthKeys: ["2026-11"], to: "2026-11-30", today: "2026-12-05" }

function vehicle(id: string, plate: string, worksiteId: string, odometer = false): typeof schema.fuelVehicles.$inferInsert {
  return odometer
    ? { id, plate, code: plate, type: "x", equipmentTypeId: IDS.eqType, meterType: "odometer", performanceUnit: "km_per_liter", worksiteId }
    : { id, plate, code: plate, type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour", worksiteId }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelVehicles).values([
    vehicle(V.tel, "FSC-0001", IDS.wsA),
    vehicle(V.mand, "FSC-0002", IDS.wsA),
    vehicle(V.km, "FSC-0003", IDS.wsA, true),
    vehicle(V.heat, "FSC-0004", IDS.wsA),
  ])
  // tel: A → B el 15-11 (mismo mandante). mand: A → C el 15-11 (otro mandante). km: A → B el 15-11.
  await setVehicleWorksiteForTest(testDb, V.tel, IDS.wsB, "2026-11-15")
  await setVehicleWorksiteForTest(testDb, V.mand, IDS.wsC, "2026-11-15")
  await setVehicleWorksiteForTest(testDb, V.km, IDS.wsB, "2026-11-15")

  let n = 0
  await testDb.insert(schema.fuelTelemetryDaily).values(
    [V.tel, V.mand].flatMap((vehicleId) => DAYS.map((day) => {
      n += 1
      return { id: `tel-fsc-${n}`, vehicleId, source: "visionlink", day, month: "2026-11", operatingHours: 8, idleHours: 2, litersWorking: 60, litersIdle: 10 }
    })),
  )

  // Una lectura por día del 10 al 20 en el equipo de odómetro.
  await testDb.insert(schema.fuelMeterReadings).values(DAYS.map((day, i) => ({
    id: `mr-fsc-${i}`, vehicleId: V.km, plate: "FSC-0003", source: "copec_tct" as const, sourceRef: `ref-fsc-${i}`,
    occurredAt: `${day}T15:00:00.000Z`, meterType: "odometer" as const, value: 10_000 + i * 100, liters: 40,
  })))

  // Cargas de L/h del equipo `tel`: una el 12-11 (en A) y otra el 17-11 (en B), cada una con la faena de la carga.
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission({ id: "ls-fsc-1", vehicleId: V.tel }),
    submission({ id: "ls-fsc-2", vehicleId: V.tel, worksiteId: IDS.wsB }),
  ])
  const load = (id: string, sub: string, worksiteId: string, at: string): typeof schema.fuelEquipmentLoads.$inferInsert => ({
    id, source: "field", taeSubmissionId: sub, vehicleId: V.tel, worksiteId, occurredAt: `${at}T15:00:00.000Z`, month: "2026-11",
    liters: 100, performanceUnit: "liters_per_hour", performanceValue: 10, performanceStatus: "computed", reviewStatus: "ok",
  })
  await testDb.insert(schema.fuelEquipmentLoads).values([
    load("fl-fsc-1", "ls-fsc-1", IDS.wsA, "2026-11-12"),
    load("fl-fsc-2", "ls-fsc-2", IDS.wsB, "2026-11-17"),
  ])

  // Mapa de calor: dos registros de consumo del mismo equipo, uno por faena (columna propia del registro).
  await testDb.insert(schema.fuelImportBatches).values([
    { id: "batch-fsc-a", worksiteId: IDS.wsA, fuente: "copec", periodoDesde: "2026-11-01", periodoHasta: "2026-11-14", archivoNombre: "a.xlsx", hashArchivo: "h-fsc-a", importadoPor: IDS.user },
    { id: "batch-fsc-b", worksiteId: IDS.wsB, fuente: "copec", periodoDesde: "2026-11-15", periodoHasta: "2026-11-30", archivoNombre: "b.xlsx", hashArchivo: "h-fsc-b", importadoPor: IDS.user },
  ])
  await testDb.insert(schema.fuelConsumptionRecords).values([
    { id: "cr-fsc-a", batchId: "batch-fsc-a", worksiteId: IDS.wsA, vehicleId: V.heat, patente: "FSC-0004", cantidadUnidad: 300, monto: 300_000, periodoDesde: "2026-11-01", periodoHasta: "2026-11-14", fuente: "copec" },
    { id: "cr-fsc-b", batchId: "batch-fsc-b", worksiteId: IDS.wsB, vehicleId: V.heat, patente: "FSC-0004", cantidadUnidad: 500, monto: 500_000, periodoDesde: "2026-11-15", periodoHasta: "2026-11-30", fuente: "copec" },
  ])
  await setVehicleWorksiteForTest(testDb, V.heat, IDS.wsB, "2026-11-15")
}, 60_000)

const days = (rows: Array<{ day: string }>) => rows.map((r) => r.day)
const expected = (from: number, to: number) => DAYS.filter((d) => Number(d.slice(8)) >= from && Number(d.slice(8)) <= to)

describe("telemetría de ralentí por la faena del día", () => {
  it("filtrando por la faena de origen sólo entran los días previos al traslado; por la de destino, los posteriores", async () => {
    const a = await idle.getIdleDailySeries(globalSession(), filtersFor({ meses: "11", faena: IDS.wsA }), V.tel)
    const b = await idle.getIdleDailySeries(globalSession(), filtersFor({ meses: "11", faena: IDS.wsB }), V.tel)
    expect(days(a)).toEqual(expected(10, 14))
    expect(days(b)).toEqual(expected(15, 20))
  })

  it("el filtro por mandante usa la faena del día: A y B son del mandante 1, C del 2", async () => {
    const m1 = await idle.getIdleDailySeries(globalSession(), filtersFor({ meses: "11", mandante: IDS.m1 }), V.mand)
    const m2 = await idle.getIdleDailySeries(globalSession(), filtersFor({ meses: "11", mandante: IDS.m2 }), V.mand)
    expect(days(m1)).toEqual(expected(10, 14))
    expect(days(m2)).toEqual(expected(15, 20))
  })

  it("el alcance de quien mira cuenta lo que el equipo hizo mientras estuvo en su faena, aunque hoy esté en otra", async () => {
    const onlyA = await idle.getIdleDailySeries(scopedSession([IDS.wsA]), filtersFor({ meses: "11" }), V.tel)
    const onlyB = await idle.getIdleDailySeries(scopedSession([IDS.wsB]), filtersFor({ meses: "11" }), V.tel)
    expect(days(onlyA)).toEqual(expected(10, 14))
    expect(days(onlyB)).toEqual(expected(15, 20))
    expect(await idle.hasTelemetryInScope(scopedSession([IDS.wsA]), filtersFor({ meses: "11" }))).toBe(true)
    expect(await idle.hasTelemetryInScope(scopedSession([IDS.wsC]), filtersFor({ meses: "11" }))).toBe(true) // `mand` en C desde el 15
  })

  it("el total mensual de una faena suma sólo los días del equipo en ella", async () => {
    const { rows } = await idle.getIdleEquipmentMonths(globalSession(), filtersFor({ meses: "11", faena: IDS.wsA }))
    const row = rows.find((r) => r.vehicleId === V.tel)!
    expect(row.operatingHours).toBe(8 * 5)
    expect(row.activeDays).toBe(5)
  })
})

describe("comparación de L/h por la faena del día", () => {
  it("telemetría por faena del día y cargas por la faena de la carga", async () => {
    const a = (await getLitersPerHourComparison(globalSession(), filtersFor({ meses: "11", faena: IDS.wsA }))).find((r) => r.vehicleId === V.tel)!
    const b = (await getLitersPerHourComparison(globalSession(), filtersFor({ meses: "11", faena: IDS.wsB }))).find((r) => r.vehicleId === V.tel)!
    // Telemetría: 5 días × 8 h con 70 L → 70/8 por día; las dos faenas ven su tramo (A 5 días, B 6 días).
    expect(a.telemetryLph).toBeCloseTo((5 * 70) / (5 * 8), 6)
    expect(b.telemetryLph).toBeCloseTo((6 * 70) / (6 * 8), 6)
    // Cargas: una por faena, aunque el equipo hoy esté sólo en B.
    expect(a.loadCount).toBe(1)
    expect(b.loadCount).toBe(1)
  })
})

describe("lecturas de medidor por la faena del día", () => {
  it("filtrando por faena entran sólo las lecturas de los días en que el equipo estaba ahí", async () => {
    const a = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, NOV)
    const b = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsB }, NOV)
    expect(a.km_per_liter.readings).toBe(5) // 10..14
    expect(b.km_per_liter.readings).toBe(6) // 15..20
    const scopedA = await getMeterRateSeries(scopedSession([IDS.wsA]), {}, NOV)
    expect(scopedA.km_per_liter.readings).toBe(5)
  })

  it("una lectura de las 23:30 hora de Chile del 14-11 sigue en la faena vieja", async () => {
    // 2026-11-15T02:30:00Z = 14-11 23:30 en Chile (UTC−3 en noviembre).
    await testDb.insert(schema.fuelMeterReadings).values({
      id: "mr-fsc-borde", vehicleId: V.km, plate: "FSC-0003", source: "copec_tct", sourceRef: "ref-fsc-borde",
      occurredAt: "2026-11-15T02:30:00.000Z", meterType: "odometer", value: 10_450, liters: 40,
    })
    const a = await getMeterRateSeries(globalSession(), { worksiteId: IDS.wsA }, NOV)
    expect(a.km_per_liter.readings).toBe(6)
  })
})

describe("mapa de calor de consumos por la faena del registro", () => {
  const session = { user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["combustibles:view"] }, expires: "2099-01-01" } as unknown as Session

  it("dos registros del mismo equipo en faenas distintas dan dos celdas, una por faena", async () => {
    const cells = await getWorksiteEquipmentMatrix(session, { fromDate: "2026-11-01", toDate: "2026-11-30" })
    const mine = cells.filter((c) => c.equipmentLabel.startsWith("FSC-0004"))
    expect(mine.map((c) => [c.worksiteName, c.liters]).sort()).toEqual([["Faena A", 300], ["Faena B", 500]])
  })
})
