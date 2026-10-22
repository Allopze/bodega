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

const { getMandante, getMediumCross, getReconciliationFlow } = await import("./reconciliation")

let txCounter = 0
function providerTx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  txCounter += 1
  return {
    id: `ptx-${txCounter}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `idk-${txCounter}`,
    fingerprint: `fp-${txCounter}`, sourceRowKey: `row-${txCounter}`, worksiteId: IDS.wsA, occurredAt: "2026-03-10T12:00:00.000Z",
    quantity: 100, status: "accepted", granularity: "transaction", payloadHash: `ph-${txCounter}`, ...overrides,
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-03-01", requestedTo: "2026-04-30", correlationId: "corr-ctl" })

  await testDb.insert(schema.fuelSupplyInputs).values([
    { id: "in-1", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsA, occurredAt: "2026-03-05T12:00:00.000Z", month: "2026-03", liters: 1000, reference: "G-1" },
    { id: "in-2", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsB, occurredAt: "2026-04-05T12:00:00.000Z", month: "2026-04", liters: 400, reference: "G-2" },
    // Otro mandante: no debe aparecer al filtrar por M1.
    { id: "in-c", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsC, occurredAt: "2026-03-05T12:00:00.000Z", month: "2026-03", liters: 5000, reference: "G-C" },
  ])
  await testDb.insert(schema.fuelProviderTransactions).values([
    providerTx({ quantity: 500 }),
    // Reemplazada por otra aceptada: no cuenta.
    providerTx({ id: "ptx-old", quantity: 77, identityKey: "old", sourceRowKey: "old" }),
    providerTx({ id: "ptx-new", quantity: 80, supersedesId: "ptx-old", identityKey: "new", sourceRowKey: "new" }),
    // Pendiente: no cuenta.
    providerTx({ quantity: 9999, status: "pending" }),
    // Agregado mensual TCT con detalle en el mismo mes y patente: se omite para no contar dos veces.
    providerTx({ id: "ptx-agg", quantity: 580, granularity: "period_aggregate", occurredAt: "2026-03-01", sourcePlate: "AA-0001", identityKey: "agg", sourceRowKey: "agg" }),
    providerTx({ id: "ptx-det", quantity: 10, sourcePlate: "AA-0001", identityKey: "det", sourceRowKey: "det" }),
    // Agregado de abril SIN detalle: sí cuenta.
    providerTx({ id: "ptx-agg-apr", quantity: 60, granularity: "period_aggregate", occurredAt: "2026-04-01", sourcePlate: "AA-0001", identityKey: "agg-apr", sourceRowKey: "agg-apr", worksiteId: IDS.wsB }),
    // Aramco no tiene canal: se mapea al medio Aramco.
    providerTx({ provider: "aramco", sourceAccount: "aramco:diesel", quantity: 40, identityKey: "ar", sourceRowKey: "ar" }),
  ])
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission({ id: "d-fixed", loadingPointId: IDS.lpFixed, supplyMediumId: IDS.mediumCmpc, liters: 600 }),
    submission({ id: "d-tank", loadingPointId: IDS.lpTank, supplyMediumId: IDS.mediumTct, liters: 450 }),
    submission({ id: "d-tae", loadingPointId: IDS.lpTae, supplyMediumId: IDS.mediumTct, liters: 100 }),
    submission({ id: "d-none", loadingPointId: null, liters: 20 }),
    submission({ id: "d-void", loadingPointId: IDS.lpFixed, liters: 7777, status: "voided" }),
    submission({ id: "d-april", worksiteId: IDS.wsB, vehicleId: IDS.vB, loadingPointId: null, supplyMediumId: IDS.mediumCmpc, liters: 300, loadedAt: "2026-04-12T15:00:00.000Z" }),
  ])
}, 60_000)

describe("getMandante", () => {
  it("devuelve tolerancia y faenas, y null si no existe o está inactivo", async () => {
    expect(await getMandante(IDS.m1)).toMatchObject({ name: "Mandante Uno", tolerancePct: 2, worksiteNames: ["Faena A", "Faena B"] })
    expect(await getMandante("no-existe")).toBeNull()
  })
})

describe("getReconciliationFlow", () => {
  it("suma entradas importadas y del proveedor, separa directo de vía estanque y calcula la diferencia", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1 }), 2)
    // Marzo: entradas 1000 + proveedor (500 + 80 + 10 + 40 aramco) = 1630. Abril: 400 + agregado 60 = 460.
    const march = flow.months.find((month) => month.month === "2026-03")!
    expect(march.inputLiters).toBe(1630)
    expect(march.directLiters).toBe(720) // 600 fijo + 100 punto TAE + 20 sin lugar
    expect(march.viaTankLiters).toBe(450)
    expect(march.differenceLiters).toBe(1630 - 1170)
    expect(march.overTolerance).toBe(true)
    const april = flow.months.find((month) => month.month === "2026-04")!
    expect(april).toMatchObject({ inputLiters: 460, directLiters: 300, viaTankLiters: 0 })
    expect(flow.totals).toMatchObject({ inputLiters: 2090, directLiters: 1020, viaTankLiters: 450 })
    expect(flow.totals.differencePct).toBeCloseTo(((2090 - 1470) / 2090) * 100, 6)
    expect(flow.assumedDirectLiters).toBe(120 + 300)
  })

  it("no cuenta anuladas, pendientes ni reemplazadas, y no mezcla otro mandante", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1, meses: "3" }), 2)
    expect(flow.totals.deliveredLiters).toBe(1170)
    expect(flow.totals.inputLiters).toBe(1630)
    const other = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m2, meses: "3" }), 5)
    expect(other.totals).toMatchObject({ inputLiters: 5000, deliveredLiters: 0 })
  })

  it("sin tolerancia (sin mandante) no declara fuera de tolerancia; con diferencia nula se marca igual", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ meses: "3" }), null)
    expect(flow.totals.overTolerance).toBeNull()
    expect(flow.totals.inputLiters).toBe(6630)
  })

  it("respeta el alcance de faena", async () => {
    const flow = await getReconciliationFlow(scopedSession([IDS.wsB]), filtersFor({ mandante: IDS.m1 }), 2)
    expect(flow.totals).toMatchObject({ inputLiters: 460, deliveredLiters: 300 })
    const none = await getReconciliationFlow(scopedSession([]), filtersFor(), 2)
    expect(none.totals).toMatchObject({ inputLiters: 0, deliveredLiters: 0, overTolerance: null })
  })

  it("dentro de tolerancia cuando la diferencia es pequeña", async () => {
    const flow = await getReconciliationFlow(globalSession(), filtersFor({ mandante: IDS.m1, meses: "4" }), 50)
    expect(flow.totals.overTolerance).toBe(false)
  })
})

describe("getMediumCross", () => {
  it("cruza lo registrado en terreno con lo informado por medio y no inventa 0 % sin informe", async () => {
    const rows = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1 }))
    const byName = new Map(rows.map((row) => [row.name, row]))
    const cmpc = byName.get("Surtidor CMPC")!
    expect(cmpc).toMatchObject({ fieldLiters: 900, fieldLoads: 2, reportedLiters: 1400 })
    expect(cmpc.differenceLiters).toBe(500)
    expect(cmpc.differencePct).toBeCloseTo((500 / 1400) * 100, 6)
    // TCT: terreno 550; informado = 500 + 80 + 10 (marzo) + 60 (agregado de abril sin detalle).
    const tct = byName.get("TCT")!
    expect(tct).toMatchObject({ fieldLiters: 550, reportedLiters: 650 })
    // Aramco sin cargas en terreno: aparece con lo informado.
    expect(byName.get("Aramco")).toMatchObject({ fieldLiters: 0, reportedLiters: 40 })
    // Sin medio asignado: hay 20 L en terreno y no existe informe.
    expect(byName.get("Sin medio asignado")).toMatchObject({ fieldLiters: 20, reportedLiters: null, differenceLiters: null, differencePct: null })
  })

  it("un medio con cargas pero sin informe del proveedor queda con reportedLiters nulo", async () => {
    const rows = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1, meses: "3" }))
    expect(rows.find((row) => row.name === "TCT")?.reportedLiters).toBe(590)
    const none = await getMediumCross(globalSession(), filtersFor({ mandante: IDS.m1, faena: IDS.wsB, meses: "3" }))
    expect(none).toEqual([])
  })
})
