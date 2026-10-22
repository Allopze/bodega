import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, scopedSession, seedControlFixtures, submission } from "./test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const idle = await import("./idle")
const { getLitersPerHourComparison } = await import("./idle-comparison")

let n = 0
function day(vehicleId: string, dayText: string, operating: number, idleHours: number, extra: Partial<typeof schema.fuelTelemetryDaily.$inferInsert> = {}): typeof schema.fuelTelemetryDaily.$inferInsert {
  n += 1
  return { id: `tel-${n}`, vehicleId, source: "visionlink", day: dayText, month: dayText.slice(0, 7), operatingHours: operating, idleHours, ...extra }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelTelemetryDaily).values([
    // Equipo A, marzo: 10 h con 2 h en vacío (20 %), 8 h con 4 h (50 %), y un día de 0,5 h en vacío total.
    day(IDS.vA, "2026-03-02", 10, 2, { litersWorking: 80, litersIdle: 10 }),
    day(IDS.vA, "2026-03-03", 8, 4, { litersWorking: 40, litersIdle: 20 }),
    day(IDS.vA, "2026-03-04", 0.5, 0.5),
    // Otra fuente informa el mismo día: no se suma, manda la de más horas de funcionamiento.
    day(IDS.vA, "2026-03-02", 6, 6, { source: "otra" }),
    // Equipo A, abril.
    day(IDS.vA, "2026-04-01", 12, 3, { litersWorking: 90, litersIdle: 15 }),
    // Equipo B (otra faena del mismo mandante), marzo.
    day(IDS.vB, "2026-03-02", 5, 1),
    // Equipo C (otro mandante).
    day(IDS.vC, "2026-03-02", 4, 4),
  ])
  // Cargas de A en marzo con L/h: promedio 14. Una en revisión y una anulada no cuentan.
  const subs = [submission({ id: "ls-1" }), submission({ id: "ls-2" }), submission({ id: "ls-3" }), submission({ id: "ls-4" })]
  await testDb.insert(schema.fuelTaeSubmissions).values(subs)
  const load = (id: string, sub: string, value: number, extra: Partial<typeof schema.fuelEquipmentLoads.$inferInsert> = {}): typeof schema.fuelEquipmentLoads.$inferInsert => ({
    id, source: "field", taeSubmissionId: sub, vehicleId: IDS.vA, worksiteId: IDS.wsA, occurredAt: "2026-03-10T15:00:00.000Z", month: "2026-03",
    liters: 100, performanceUnit: "liters_per_hour", performanceValue: value, performanceStatus: "computed", reviewStatus: "ok", ...extra,
  })
  await testDb.insert(schema.fuelEquipmentLoads).values([
    load("fl-1", "ls-1", 12), load("fl-2", "ls-2", 16),
    load("fl-flag", "ls-3", 99, { reviewStatus: "flagged" }),
    load("fl-void", "ls-4", 99, { voidedAt: "2026-03-11T00:00:00.000Z" }),
  ])
}, 60_000)

describe("getIdleEquipmentMonths", () => {
  it("recalcula el % desde las horas, promedia por día con actividad y reporta promedio/máx/mín diarios", async () => {
    const { rows } = await idle.getIdleEquipmentMonths(globalSession(), filtersFor({ meses: "3", faena: IDS.wsA }))
    expect(rows).toHaveLength(1)
    const march = rows[0]!
    // El 2 de marzo dos fuentes informan al equipo: no se suman, manda la de más horas (10 h, no la de 6 h).
    expect(march.operatingHours).toBeCloseTo(18.5, 6)
    expect(march.idleHours).toBeCloseTo(6.5, 6)
    expect(march.idlePct).toBeCloseTo((6.5 / 18.5) * 100, 6)
    expect(march.activeDays).toBe(3)
    expect(march.dailyMaxPct).toBeCloseTo(100, 6)
    expect(march.dailyMinPct).toBeCloseTo(20, 6)
    expect(march.dailyAvgPct).toBeCloseTo((20 + 50 + 100) / 3, 6)
    expect(march.avgWorkingPerDay).toBeCloseTo(12 / 3, 6)
    expect(march.avgIdlePerDay).toBeCloseTo(6.5 / 3, 6)
    expect(march.litersWorking).toBe(120)
    expect(march.litersIdle).toBe(30)
  })

  it("entrega la fila de total general y respeta el alcance", async () => {
    const all = await idle.getIdleEquipmentMonths(globalSession(), filtersFor({ meses: "3" }))
    expect(all.rows.map((row) => row.equipment)).toEqual(["KA-1 · AA-0001", "KB-2 · BB-0002", "CC-0003"])
    expect(all.total?.operatingHours).toBeCloseTo(18.5 + 5 + 4, 6)
    const scoped = await idle.getIdleEquipmentMonths(scopedSession([IDS.wsB]), filtersFor({ meses: "3" }))
    expect(scoped.rows.map((row) => row.vehicleId)).toEqual([IDS.vB])
    const mandante = await idle.getIdleEquipmentMonths(globalSession(), filtersFor({ meses: "3", mandante: IDS.m2 }))
    expect(mandante.rows.map((row) => row.vehicleId)).toEqual([IDS.vC])
    const empty = await idle.getIdleEquipmentMonths(scopedSession([]), filtersFor())
    expect(empty).toEqual({ rows: [], total: null })
  })

  it("el rango de días se evalúa sobre `day`", async () => {
    const { rows } = await idle.getIdleEquipmentMonths(globalSession(), filtersFor({ desde: "2026-03-03", hasta: "2026-04-01", faena: IDS.wsA }))
    expect(rows.map((row) => [row.month, row.operatingHours])).toEqual([["2026-03", 8.5], ["2026-04", 12]])
  })
})

describe("series y rankings", () => {
  it("serie mensual de la flota con % de litros en vacío solo cuando hay ambos litros", async () => {
    const months = await idle.getIdleFleetMonths(globalSession(), filtersFor({ meses: "3,4", faena: IDS.wsA }))
    expect(months.map((m) => m.month)).toEqual(["2026-03", "2026-04"])
    expect(months[0]).toMatchObject({ workingHours: 12, idleHours: 6.5, litersWorking: 120, litersIdle: 30 })
    expect(months[0]?.idleLitersPct).toBeCloseTo((30 / 150) * 100, 6)
    const noLiters = await idle.getIdleFleetMonths(globalSession(), filtersFor({ meses: "3", faena: IDS.wsB }))
    expect(noLiters[0]?.idleLitersPct).toBeNull()
  })

  it("lista equipos por horas y arma la serie diaria del elegido", async () => {
    const vehicles = await idle.listIdleVehicles(globalSession(), filtersFor({ meses: "3,4" }))
    expect(vehicles[0]).toMatchObject({ id: IDS.vA })
    const daily = await idle.getIdleDailySeries(globalSession(), filtersFor({ meses: "3" }), IDS.vA)
    expect(daily.map((point) => point.day)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"])
    expect(daily[1]?.idlePct).toBeCloseTo(50, 6)
  })

  it("los días con más ralentí exigen al menos 1 hora de funcionamiento, ordenan por % y desempatan por horas", async () => {
    const top = await idle.getIdleTopDays(globalSession(), filtersFor({ meses: "3" }), 20)
    expect(top.map((row) => `${row.day}|${row.equipment}`)).toEqual(["2026-03-02|CC-0003", "2026-03-03|KA-1 · AA-0001", "2026-03-02|KA-1 · AA-0001", "2026-03-02|KB-2 · BB-0002"])
    expect(top[0]?.idlePct).toBeCloseTo(100, 6)
    expect(await idle.getIdleTopDays(globalSession(), filtersFor({ meses: "3" }), 2)).toHaveLength(2)
  })

  it("distingue «nunca se importó» de «sin datos en el período»", async () => {
    expect(await idle.hasTelemetryInScope(globalSession(), filtersFor({ meses: "1" }))).toBe(true)
    expect(await idle.hasTelemetryInScope(scopedSession([]), filtersFor())).toBe(false)
  })
})

describe("getLitersPerHourComparison", () => {
  it("compara L/h de telemetría con el promedio de las cargas válidas del mes", async () => {
    const rows = await getLitersPerHourComparison(globalSession(), filtersFor({ meses: "3,4", faena: IDS.wsA }))
    const march = rows.find((row) => row.month === "2026-03")!
    expect(march.telemetryLph).toBeCloseTo(150 / 18.5, 6)
    expect(march.loadsLph).toBe(14) // 12 y 16; la carga en revisión y la anulada no entran.
    expect(march.loadCount).toBe(2)
    expect(march.differencePct).toBeCloseTo(((150 / 18.5 - 14) / 14) * 100, 6)
    const april = rows.find((row) => row.month === "2026-04")!
    expect(april).toMatchObject({ loadsLph: null, loadCount: 0, differencePct: null })
    expect(april.telemetryLph).toBeCloseTo(105 / 12, 6)
  })

  it("sin litros de telemetría no hay L/h", async () => {
    const rows = await getLitersPerHourComparison(globalSession(), filtersFor({ meses: "3", faena: IDS.wsB }))
    expect(rows[0]?.telemetryLph).toBeNull()
  })
})
