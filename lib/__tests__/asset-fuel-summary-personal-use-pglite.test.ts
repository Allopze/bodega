import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * El combustible de gestión del Panel operacional sin los días de uso personal:
 * `getAssetFuelSummary` (monto, litros de terreno y rendimiento medio) y
 * `getFuelBilledByVehicleDay` (el mismo monto por día, que reparte Costo por contrato).
 *
 * - Transacción de proveedor: se excluye la del día de Chile dentro del período. El borde
 *   horario cuenta: las 22:30 del último día del período (`…T01:30Z` del día siguiente)
 *   caen dentro; las 00:30 del día siguiente, fuera.
 * - TCT mensual: se prorratea por los días del mes fuera del período, también si el período
 *   está abierto (cubre hasta el final del rango).
 * - Cargas en terreno: los litros omiten el día del período; el rendimiento medio omite las
 *   cargas del período y la primera después.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getAssetFuelSummary, getFuelBilledByVehicleDay } = await import("@/lib/combustibles/control/queries/asset-fuel-summary")
const { getOperationalControlHub } = await import("@/lib/services/operational-control")

function session(extra: string[] = []): Session {
  return {
    user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["combustibles:view", "combustibles:view_costs", ...extra] },
    expires: "2099-01-01",
  } as unknown as Session
}

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" }
// vA: transacciones y cargas; período 10–19 de octubre.
// vB: TCT de octubre; período 10–19 (cierra dentro del mes).
// vC: TCT de octubre; período abierto desde el 25.
let seq = 0

async function addTx(input: { vehicle: string; worksite: string; plate: string; occurredAt: string; amount: number; granularity?: "transaction" | "period_aggregate"; account?: string }) {
  seq += 1
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `afp-tx-${seq}`, syncRunId: "afp-run", provider: "copec", sourceAccount: input.account ?? "tct:diesel",
    identityKey: `afp-idk-${seq}`, fingerprint: `afp-fp-${seq}`, sourceRowKey: `afp-row-${seq}`, payloadHash: `afp-ph-${seq}`,
    worksiteId: input.worksite, vehicleId: input.vehicle, sourcePlate: input.plate, occurredAt: input.occurredAt,
    quantity: input.amount / 1000, amount: input.amount, status: "accepted", granularity: input.granularity ?? "transaction",
  })
}

async function addLoad(id: string, day: string, liters: number, perf: number) {
  const at = `${day}T15:00:00.000Z`
  const sub = submission({ vehicleId: IDS.vA, loadedAt: at, submittedAt: at, liters })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id, source: "field", taeSubmissionId: sub.id, vehicleId: IDS.vA, worksiteId: IDS.wsA, occurredAt: at,
    month: day.slice(0, 7), liters, performanceUnit: "liters_per_hour", performanceValue: perf, performanceStatus: "computed", reviewStatus: "ok",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "afp-run", provider: "copec", requestedFrom: "2026-09-01", requestedTo: "2026-10-31", correlationId: "corr-afp",
  })
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
    { id: "afp-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" },
    { id: "afp-pu-b", vehicleId: IDS.vB, startedOn: "2026-10-10", endedOn: "2026-10-19" },
    { id: "afp-pu-c", vehicleId: IDS.vC, startedOn: "2026-10-25", endedOn: null },
  ])

  const a = { vehicle: IDS.vA, worksite: IDS.wsA, plate: "AA-0001" }
  await addTx({ ...a, occurredAt: "2026-10-15T14:00:00.000Z", amount: 100_000 }) // dentro: excluida
  await addTx({ ...a, occurredAt: "2026-10-25T14:00:00.000Z", amount: 50_000 }) // fuera: cuenta
  await addTx({ ...a, occurredAt: "2026-10-20T01:30:00.000Z", amount: 7_000 }) // 22:30 del 19: último día, excluida
  await addTx({ ...a, occurredAt: "2026-10-20T03:30:00.000Z", amount: 3_000 }) // 00:30 del 20: cuenta
  // TCT en otra cuenta que el detalle de vA: con detalle de la misma cuenta, patente y mes el agregado no cuenta.
  await addTx({ vehicle: IDS.vB, worksite: IDS.wsB, plate: "BB-0002", occurredAt: "2026-10-01", amount: 310_000, granularity: "period_aggregate", account: "tct:gasolina" })
  await addTx({ vehicle: IDS.vC, worksite: IDS.wsC, plate: "CC-0003", occurredAt: "2026-10-01", amount: 310_000, granularity: "period_aggregate", account: "tct:gasolina" })

  // Cargas de vA: 05 (antes), 12 (dentro), 22 (primera después) y 28.
  await addLoad("afp-l-05", "2026-10-05", 100, 10)
  await addLoad("afp-l-12", "2026-10-12", 200, 20)
  await addLoad("afp-l-22", "2026-10-22", 300, 30)
  await addLoad("afp-l-28", "2026-10-28", 400, 40)

  // Horómetro de vA (VisionLink): 2→9 (+70), 9→20 (+30, recorre el período), 20→25 (+50), 25→30 (+30).
  const readings: Array<[string, number]> = [["2026-10-02", 1000], ["2026-10-09", 1070], ["2026-10-20", 1100], ["2026-10-25", 1150], ["2026-10-30", 1180]]
  await testDb.insert(schema.fuelMeterReadings).values(readings.map(([day, value], i) => ({
    id: `afp-mr-${i}`, vehicleId: IDS.vA, plate: "AA-0001", source: "visionlink_api", sourceRef: `afp-ref-${i}`,
    occurredAt: `${day}T15:00:00.000Z`, meterType: "hour_meter", value,
  })))
}, 60_000)

describe("getAssetFuelSummary sin uso personal", () => {
  it("el monto excluye las transacciones del período, con el borde horario de Chile", async () => {
    const summary = await getAssetFuelSummary(session(), OCTOBER, [IDS.vA])
    // 50.000 (25 oct) + 3.000 (00:30 del 20). Quedan fuera 100.000 (día 15) y 7.000 (22:30 del 19).
    expect(summary.get(IDS.vA)!.billedAmount).toBe(53_000)
  })

  it("el TCT mensual se prorratea por los días fuera del período", async () => {
    const summary = await getAssetFuelSummary(session(), OCTOBER, [IDS.vB, IDS.vC])
    expect(summary.get(IDS.vB)!.billedAmount).toBeCloseTo(210_000, 4) // 310.000 × 21/31
    expect(summary.get(IDS.vC)!.billedAmount).toBeCloseTo(240_000, 4) // abierto desde el 25: 310.000 × 24/31
  })

  it("los litros de terreno omiten el día del período; el rendimiento omite la carga del período y la primera después", async () => {
    const entry = (await getAssetFuelSummary(session(), OCTOBER, [IDS.vA])).get(IDS.vA)!
    expect(entry.liters).toBe(800) // 100 + 300 + 400
    expect(entry.performanceValue).toBeCloseTo(25, 6) // promedio de 10 (día 5) y 40 (día 28)
  })

  it("el conteo de cargas omite la del período, igual que los litros y la ficha", async () => {
    const entry = (await getAssetFuelSummary(session(), OCTOBER, [IDS.vA])).get(IDS.vA)!
    expect(entry.loadCount).toBe(3) // 05, 22 y 28; la del 12 es de uso personal
  })

  it("quitar el período devuelve las cifras de antes: nada queda cacheado", async () => {
    const before = (await getAssetFuelSummary(session(), OCTOBER, [IDS.vA])).get(IDS.vA)!
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods).where(eq(schema.fuelVehiclePersonalUsePeriods.id, "afp-pu-a"))
    const after = (await getAssetFuelSummary(session(), OCTOBER, [IDS.vA])).get(IDS.vA)!
    expect(before.billedAmount).toBe(53_000)
    expect(after.billedAmount).toBe(160_000)
    expect(after.liters).toBe(1000)
    await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: "afp-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" })
  })
})

describe("getFuelBilledByVehicleDay sin uso personal", () => {
  it("devuelve los mismos montos que el resumen, por día", async () => {
    const rows = await getFuelBilledByVehicleDay(session(), OCTOBER, [IDS.vA, IDS.vB, IDS.vC])
    const byVehicle = (id: string) => rows.filter((r) => r.vehicleId === id)
    const sumOf = (id: string) => byVehicle(id).reduce((acc, r) => acc + r.amount, 0)
    const summary = await getAssetFuelSummary(session(), OCTOBER, [IDS.vA, IDS.vB, IDS.vC])
    for (const id of [IDS.vA, IDS.vB, IDS.vC]) expect(sumOf(id)).toBeCloseTo(summary.get(id)!.billedAmount!, 4)
    expect(byVehicle(IDS.vA).map((r) => r.day).sort()).toEqual(["2026-10-20", "2026-10-25"])
    expect(byVehicle(IDS.vB)).toHaveLength(1)
    expect(byVehicle(IDS.vB)[0]!.spansMonth).toBe(true)
  })
})

describe("Control operacional con uso personal", () => {
  it("el avance GPS omite el tramo que recorre el período; la nota cuenta sus días", async () => {
    const hub = await getOperationalControlHub(session(["flota:view", "purchasing:view"]), OCTOBER, { includeAttention: false })
    const asset = hub.assets.find((a) => a.kind === "vehicle" && a.id === IDS.vA)!
    // 150 h = 70 + 50 + 30; sin el descuento serían 180 h.
    expect(asset.personalUseDays).toBe(10)
    expect(asset.fuelLiters).toBe(800)
    expect(asset.gpsPerformanceStatus).toBe("ok")
    expect(asset.gpsPerformanceValue).toBeCloseTo(800 / 150, 6)
    expect(asset.totalCost).toBe(53_000)
    expect(asset.gpsCostPerUnit).toBeCloseTo(53_000 / 150, 6)
    // Un equipo sin período no tiene nota.
    const other = hub.assets.find((a) => a.kind === "vehicle" && a.id === IDS.vC)!
    expect(other.personalUseDays).toBe(7) // abierto desde el 25: 25..31
  })
})
