import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"
import { addMonths, todayInChile } from "@/lib/utils"

/**
 * Uso personal en Flota (gasto de 12 meses y totales de página), en el top de Analítica
 * y en la tendencia mensual de Inicio: lo que el equipo gastó y recorrió en los días del
 * dueño no suma, el TCT mensual se prorratea por días y un mes cuyas únicas transacciones
 * fueron de uso personal queda en cero (no en un hueco del proveedor). Quitar el período
 * devuelve las cifras de siempre.
 *
 * Los meses se calculan desde hoy (el mes pasado y el anterior) para que la ventana móvil
 * de 12 meses no suelte los datos con el paso del tiempo.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getFleetOverview, getFleetOverviewPage } = await import("@/lib/services/fleet")
const { getAnalyticsDashboard } = await import("@/lib/services/analytics-module/dashboard")
const { getFuelMonthlyTrend } = await import("@/lib/services/dashboard-fuel")

const TODAY = todayInChile()
const M1 = addMonths(TODAY, -1).slice(0, 7)
const M2 = addMonths(TODAY, -2).slice(0, 7)
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
const at = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}T14:00:00.000Z`

const session = {
  user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["flota:view", "combustibles:view", "combustibles:view_costs"] },
  expires: "2099-01-01",
} as unknown as Session

let seq = 0
async function addTx(input: { vehicle: string; worksite: string; occurredAt: string; amount: number; quantity: number; granularity?: "transaction" | "period_aggregate" }) {
  seq += 1
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `fa-tx-${seq}`, syncRunId: "fa-run", provider: "copec", sourceAccount: "tct:diesel",
    identityKey: `fa-idk-${seq}`, fingerprint: `fa-fp-${seq}`, sourceRowKey: `fa-row-${seq}`, payloadHash: `fa-ph-${seq}`,
    worksiteId: input.worksite, vehicleId: input.vehicle, sourcePlate: `PL-${input.vehicle}`, occurredAt: input.occurredAt,
    quantity: input.quantity, amount: input.amount, status: "accepted", granularity: input.granularity ?? "transaction",
  })
}

async function markPersonalUse(vehicleId: string, startedOn: string, endedOn: string | null) {
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: `fa-pu-${++seq}`, vehicleId, startedOn, endedOn })
}

/** Uso personal de vA el 10-19 del mes pasado, de vB el 1-10 del mes pasado y de vA el 10-15 de hace dos meses. */
async function markAll() {
  await markPersonalUse(IDS.vA, `${M1}-10`, `${M1}-19`)
  await markPersonalUse(IDS.vB, `${M1}-01`, `${M1}-10`)
  await markPersonalUse(IDS.vA, `${M2}-10`, `${M2}-15`)
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "fa-run", provider: "copec", requestedFrom: `${M2}-01`, requestedTo: `${M1}-28`, correlationId: "corr-fa",
  })
  // vA: una carga dentro del período del mes pasado y otra fuera; hace dos meses sólo una, dentro de su período.
  await addTx({ vehicle: IDS.vA, worksite: IDS.wsA, occurredAt: at(M1, 15), amount: 100_000, quantity: 100 })
  await addTx({ vehicle: IDS.vA, worksite: IDS.wsA, occurredAt: at(M1, 25), amount: 50_000, quantity: 50 })
  await addTx({ vehicle: IDS.vA, worksite: IDS.wsA, occurredAt: at(M2, 12), amount: 40_000, quantity: 40 })
  // vB: el agregado mensual TCT del mes pasado, sin detalle.
  await addTx({ vehicle: IDS.vB, worksite: IDS.wsB, occurredAt: `${M1}-01`, amount: 310_000, quantity: 310, granularity: "period_aggregate" })
  // vC: sin uso personal.
  await addTx({ vehicle: IDS.vC, worksite: IDS.wsC, occurredAt: at(M1, 15), amount: 20_000, quantity: 20 })

  // Horómetro de vA (Copec): +10 h en cada lectura; el período del mes pasado cubre del 10 al 19.
  const readings: Array<[number, number]> = [[1, 1_000], [5, 1_010], [12, 1_020], [22, 1_030]]
  await testDb.insert(schema.fuelMeterReadings).values(readings.map(([day, value], i) => ({
    id: `fa-mr-${i}`, vehicleId: IDS.vA, plate: "AA0001", source: "copec_tct", sourceRef: `fa-ref-${i}`,
    occurredAt: at(M1, day), meterType: "hour_meter", value,
  })))
}, 60_000)

afterEach(async () => {
  await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
})

const byId = (rows: Awaited<ReturnType<typeof getFleetOverview>>) => new Map(rows.map((row) => [row.id, row]))
const keptB = () => 310_000 * (daysIn(M1) - 10) / daysIn(M1)

describe("Flota: gasto de 12 meses y recorrido", () => {
  it("sin uso personal suma todo", async () => {
    const rows = byId(await getFleetOverview(session))
    expect(rows.get(IDS.vA)).toMatchObject({ totalFuelAmount: 190_000, totalLiters: 190, hoursRun: 30 })
    expect(Number(rows.get(IDS.vB)!.totalFuelAmount)).toBe(310_000)
  })

  it("no suma la transacción del período, prorratea el TCT por días y no cuenta las horas del dueño", async () => {
    await markAll()
    const rows = byId(await getFleetOverview(session))
    // vA: sólo la del día 25 del mes pasado; la de hace dos meses cae en su período.
    expect(rows.get(IDS.vA)).toMatchObject({ totalFuelAmount: 50_000, totalLiters: 50 })
    // Horas: 01→05 (+10) queda; 05→12 y 12→22 recorren días del período.
    expect(rows.get(IDS.vA)!.hoursRun).toBe(10)
    expect(Number(rows.get(IDS.vB)!.totalFuelAmount)).toBeCloseTo(keptB(), 4)
    expect(Number(rows.get(IDS.vB)!.totalLiters)).toBeCloseTo(keptB() / 1000, 6)
    // vC, sin período, no cambia.
    expect(rows.get(IDS.vC)).toMatchObject({ totalFuelAmount: 20_000, totalLiters: 20 })
  })

  it("los totales de la página siguen la misma regla", async () => {
    const dates = { today: TODAY, warningWindowEnd: TODAY }
    const before = await getFleetOverviewPage(session, {}, dates, { offset: 0, limit: 50 })
    expect(before.summary.totalFuelAmount).toBe(190_000 + 310_000 + 20_000)
    await markAll()
    const after = await getFleetOverviewPage(session, {}, dates, { offset: 0, limit: 50 })
    expect(after.summary.totalFuelAmount).toBeCloseTo(50_000 + keptB() + 20_000, 4)
    expect(after.summary.totalLiters).toBeCloseTo(50 + keptB() / 1000 + 20, 6)
  })

  it("quitar el período devuelve las cifras de siempre", async () => {
    await markAll()
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
    const rows = byId(await getFleetOverview(session))
    expect(rows.get(IDS.vA)).toMatchObject({ totalFuelAmount: 190_000, hoursRun: 30 })
  })
})

describe("Analítica", () => {
  const filters = { fromDate: `${M1}-01`, toDate: `${M1}-${daysIn(M1)}` }

  it("el gasto y el top de equipos no suman el uso personal", async () => {
    const before = await getAnalyticsDashboard(session, filters)
    expect(before.kpis).toMatchObject({ fuelAmount: 100_000 + 50_000 + 310_000 + 20_000, fuelLiters: 100 + 50 + 310 + 20 })
    await markAll()
    const after = await getAnalyticsDashboard(session, filters)
    expect(after.kpis.fuelAmount).toBeCloseTo(50_000 + keptB() + 20_000, 4)
    expect(after.kpis.fuelLiters).toBeCloseTo(50 + keptB() / 1000 + 20, 6)
    expect(after.vehicleCosts.find((row) => row.id === IDS.vA)).toMatchObject({ totalFuelAmount: 50_000, totalLiters: 50 })
    expect(after.vehicleCosts.find((row) => row.id === IDS.vC)).toMatchObject({ totalFuelAmount: 20_000 })
  })

  it("la tendencia mensual excluye el uso personal y un mes sólo de uso personal queda en cero, no en un hueco", async () => {
    await markAll()
    const data = await getAnalyticsDashboard(session, filters)
    const months = new Map(data.spendByMonth.map((row) => [row.month, row]))
    expect(months.get(M1)!.fuelAmount).toBeCloseTo(50_000 + keptB() + 20_000, 4)
    // Hace dos meses sólo hubo una transacción y cae en el período: el mes sigue con datos del proveedor.
    expect(months.get(M2)!.fuelAmount).toBe(0)
  })
})

describe("Inicio: tendencia de combustible", () => {
  it("excluye el uso personal por mes y no confunde un mes sólo de uso personal con un hueco", async () => {
    const before = await getFuelMonthlyTrend(session, 3)
    expect(before.find((point) => point.monthKey === M2)).toMatchObject({ amount: 40_000, liters: 40, providerGap: false })
    await markAll()
    const after = await getFuelMonthlyTrend(session, 3)
    const m1 = after.find((point) => point.monthKey === M1)!
    expect(m1.amount).toBeCloseTo(50_000 + keptB() + 20_000, 4)
    expect(m1.liters).toBeCloseTo(50 + keptB() / 1000 + 20, 6)
    expect(after.find((point) => point.monthKey === M2)).toMatchObject({ amount: 0, liters: 0, loads: 0, providerGap: false })
  })
})
