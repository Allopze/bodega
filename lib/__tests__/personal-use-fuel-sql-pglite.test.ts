import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, inArray, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Piezas compartidas del uso personal en combustible, contra Postgres de verdad:
 * - transacciones de proveedor: se excluye la del día de Chile en el período y el
 *   TCT mensual se prorratea por días;
 * - cargas en terreno: `buildManagementLoadWhere` excluye las del período y
 *   `buildLoadWhere` (cola de revisión, listados) no cambia;
 * - rendimiento: se excluyen las cargas del período y la primera después;
 * - telemetría diaria (ralentí): `dailyTelemetry(..., "exclude")` omite los días.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const {
  providerTxKeptWhereSql, providerTxKeptAmountSql, providerTxKeptQuantitySql, performanceTaintedByPersonalUseSql,
} = await import("@/lib/combustibles/personal-use-fuel-sql")
const { buildLoadWhere, buildManagementLoadWhere } = await import("@/lib/combustibles/control/filters")
const { dailyTelemetry } = await import("@/lib/combustibles/control/queries/idle")

const T = schema.fuelProviderTransactions
const L = schema.fuelEquipmentLoads

let seq = 0
async function addTx(input: { vehicle: string | null; occurredAt: string; amount: number; quantity?: number; granularity?: "transaction" | "period_aggregate" }) {
  seq += 1
  await testDb.insert(T).values({
    id: `pf-tx-${seq}`, syncRunId: "pf-run", provider: "copec", sourceAccount: "tct:diesel",
    identityKey: `pf-idk-${seq}`, fingerprint: `pf-fp-${seq}`, sourceRowKey: `pf-row-${seq}`, payloadHash: `pf-ph-${seq}`,
    worksiteId: IDS.wsA, vehicleId: input.vehicle, sourcePlate: "AA-0001", occurredAt: input.occurredAt,
    quantity: input.quantity ?? input.amount / 1000, amount: input.amount, status: "accepted",
    granularity: input.granularity ?? "transaction",
  })
  return `pf-tx-${seq}`
}

async function addLoad(id: string, vehicleId: string, day: string, liters: number, meterReading: number | null = null) {
  const sub = submission({ vehicleId, loadedAt: `${day}T15:00:00.000Z`, submittedAt: `${day}T15:00:00.000Z` })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(L).values({
    id, source: "field", taeSubmissionId: sub.id, vehicleId, worksiteId: IDS.wsA, occurredAt: `${day}T15:00:00.000Z`,
    month: day.slice(0, 7), liters, meterReading, performanceUnit: "liters_per_hour", performanceValue: 10, performanceStatus: "computed", reviewStatus: "ok",
  })
}

async function txIds(where: ReturnType<typeof sql>) {
  const rows = await testDb.select({ id: T.id }).from(T).where(where)
  return rows.map((r) => r.id).sort()
}

const ids: Record<string, string> = {}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "pf-run", provider: "copec", requestedFrom: "2026-09-01", requestedTo: "2026-10-31", correlationId: "corr-pf",
  })
  // vA: uso personal del 10 al 19 de octubre. vB: abierto desde el 25 de octubre.
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
    { id: "pf-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" },
    { id: "pf-pu-b", vehicleId: IDS.vB, startedOn: "2026-10-25", endedOn: null },
  ])

  ids.inside = await addTx({ vehicle: IDS.vA, occurredAt: "2026-10-15T14:00:00.000Z", amount: 100_000 })
  ids.outside = await addTx({ vehicle: IDS.vA, occurredAt: "2026-10-25T14:00:00.000Z", amount: 50_000 })
  // 22:30 del 19 en Chile (último día del período) → excluida; 00:30 del 20 → cuenta.
  ids.lateLastDay = await addTx({ vehicle: IDS.vA, occurredAt: "2026-10-20T01:30:00.000Z", amount: 7_000 })
  ids.nextDay = await addTx({ vehicle: IDS.vA, occurredAt: "2026-10-20T03:30:00.000Z", amount: 3_000 })
  ids.noVehicle = await addTx({ vehicle: null, occurredAt: "2026-10-15T14:00:00.000Z", amount: 9_000 })
  ids.tctOctober = await addTx({ vehicle: IDS.vA, occurredAt: "2026-10-01", amount: 310_000, quantity: 310, granularity: "period_aggregate" })
  ids.tctOpen = await addTx({ vehicle: IDS.vB, occurredAt: "2026-10-01", amount: 310_000, quantity: 310, granularity: "period_aggregate" })
  ids.tctSeptember = await addTx({ vehicle: IDS.vA, occurredAt: "2026-09-01", amount: 300_000, quantity: 300, granularity: "period_aggregate" })

  // Cargas de vA: 05 (antes), 12 (dentro), 22 (primera después) y 28.
  await addLoad("pf-l-05", IDS.vA, "2026-10-05", 100)
  await addLoad("pf-l-12", IDS.vA, "2026-10-12", 200)
  await addLoad("pf-l-22", IDS.vA, "2026-10-22", 300)
  await addLoad("pf-l-28", IDS.vA, "2026-10-28", 400)

  // vB en septiembre: lectura el 05, uso personal 08–09, carga SIN lectura el 10 y con lectura el 18.
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: "pf-pu-b-sep", vehicleId: IDS.vB, startedOn: "2026-09-08", endedOn: "2026-09-09" })
  await addLoad("pf-lb-05", IDS.vB, "2026-09-05", 50, 1000)
  await addLoad("pf-lb-10", IDS.vB, "2026-09-10", 50, null)
  await addLoad("pf-lb-18", IDS.vB, "2026-09-18", 50, 1200)

  await testDb.insert(schema.fuelTelemetryDaily).values(["2026-10-08", "2026-10-15", "2026-10-25"].map((day, i) => ({
    id: `pf-tel-${i}`, vehicleId: IDS.vA, source: "visionlink", day, month: "2026-10", operatingHours: 8, idleHours: 2, litersWorking: 60, litersIdle: 10,
  })))
}, 60_000)

describe("transacciones de proveedor", () => {
  it("excluye por el día de Chile; el borde horario del último día queda dentro", async () => {
    const kept = await txIds(and(eq(T.granularity, "transaction"), providerTxKeptWhereSql())!)
    expect(kept).toEqual([ids.outside, ids.nextDay, ids.noVehicle].sort())
  })

  it("el TCT mensual siempre pasa el filtro: se prorratea, no se excluye", async () => {
    const kept = await txIds(and(eq(T.granularity, "period_aggregate"), providerTxKeptWhereSql())!)
    expect(kept).toEqual([ids.tctOctober, ids.tctOpen, ids.tctSeptember].sort())
  })

  it("prorratea el monto y los litros del TCT por los días fuera del uso personal", async () => {
    const rows = await testDb.select({ id: T.id, amount: providerTxKeptAmountSql(), quantity: providerTxKeptQuantitySql() })
      .from(T).where(inArray(T.id, [ids.tctOctober!, ids.tctOpen!, ids.tctSeptember!, ids.outside!]))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(Number(byId.get(ids.tctOctober!)!.amount)).toBeCloseTo(210_000, 4) // 310.000 × 21/31
    expect(Number(byId.get(ids.tctOctober!)!.quantity)).toBeCloseTo(210, 6)
    expect(Number(byId.get(ids.tctOpen!)!.amount)).toBeCloseTo(240_000, 4) // abierto desde el 25: 310.000 × 24/31
    expect(Number(byId.get(ids.tctSeptember!)!.amount)).toBeCloseTo(300_000, 4)
    expect(Number(byId.get(ids.outside!)!.amount)).toBe(50_000)
  })
})

describe("cargas en terreno", () => {
  it("buildManagementLoadWhere excluye las cargas del período; buildLoadWhere no cambia", async () => {
    const session = globalSession()
    const filters = filtersFor({ meses: "10" })
    const liters = async (where: ReturnType<typeof sql>) =>
      Number((await testDb.select({ v: sql<number>`coalesce(sum(${L.liters}), 0)` }).from(L).where(and(eq(L.vehicleId, IDS.vA), where)))[0]!.v)
    expect(await liters(buildLoadWhere(session, filters))).toBe(1000)
    expect(await liters(buildManagementLoadWhere(session, filters))).toBe(800)
  })

  it("el rendimiento excluye las cargas del período y la primera después", async () => {
    const rows = await testDb.select({ id: L.id, tainted: performanceTaintedByPersonalUseSql() })
      .from(L).where(eq(L.vehicleId, IDS.vA))
    const tainted = rows.filter((r) => r.tainted).map((r) => r.id).sort()
    expect(tainted).toEqual(["pf-l-12", "pf-l-22"])
  })
})

describe("rendimiento contra la lectura anterior", () => {
  it("una carga sin lectura en medio no tapa el uso personal: la del 18 se mide contra la del 05", async () => {
    const rows = await testDb.select({ id: L.id, tainted: performanceTaintedByPersonalUseSql() })
      .from(L).where(eq(L.vehicleId, IDS.vB))
    const tainted = rows.filter((r) => r.tainted).map((r) => r.id).sort()
    expect(tainted).toContain("pf-lb-18")
    expect(tainted).not.toContain("pf-lb-05")
  })
})

describe("telemetría diaria", () => {
  it("«exclude» omite los días del período e «include» los conserva", async () => {
    const session = globalSession()
    const filters = filtersFor({ meses: "10" })
    const daysOf = async (mode: "exclude" | "include") => {
      const d = dailyTelemetry(session, filters, mode)
      const rows = await testDb.select({ day: d.day, vehicleId: d.vehicleId }).from(d)
      return rows.filter((r) => r.vehicleId === IDS.vA).map((r) => r.day).sort()
    }
    expect(await daysOf("include")).toEqual(["2026-10-08", "2026-10-15", "2026-10-25"])
    expect(await daysOf("exclude")).toEqual(["2026-10-08", "2026-10-25"])
  })
})
