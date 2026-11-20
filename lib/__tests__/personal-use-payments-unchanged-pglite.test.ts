import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Anti-objetivo 1 de la spec del uso personal: marcar un período NO cambia lo que
 * se le paga a Copec o a un proveedor. La cuadratura (flujo de reconciliación y
 * cruce por medio), su resumen por mandante y lo que falta pagar dan exactamente
 * lo mismo con y sin períodos marcados (Review Focus 5).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getMediumCross, getReconciliationFlow } = await import("@/lib/combustibles/control/queries/reconciliation")
const { getMandantesReconciliationSummary } = await import("@/lib/combustibles/control/queries/reconciliation-summary")
const { getPayablesSummary } = await import("@/lib/combustibles/payables-summary")
const { resolveFuelPeriod, currentMonthPeriod } = await import("@/lib/combustibles/period")

const costSession = {
  user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["combustibles:view", "combustibles:view_costs"] },
  expires: "2099-01-01",
} as unknown as Session

let seq = 0
function providerTx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  seq += 1
  return {
    id: `pay-tx-${seq}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `pay-idk-${seq}`,
    fingerprint: `pay-fp-${seq}`, sourceRowKey: `pay-row-${seq}`, payloadHash: `pay-ph-${seq}`, worksiteId: IDS.wsA,
    vehicleId: IDS.vA, sourcePlate: "AA-0001", occurredAt: "2026-03-12T14:00:00.000Z", quantity: 100, amount: 100_000,
    status: "accepted", granularity: "transaction", ...overrides,
  }
}

async function snapshot() {
  const filters = filtersFor({ meses: "3" })
  const period = resolveFuelPeriod({ searchParams: { periodo: "2026-03" }, cookieValue: null, fallback: currentMonthPeriod() })
  return {
    flow: await getReconciliationFlow(globalSession(), filters, 2),
    cross: await getMediumCross(globalSession(), filters),
    summary: await getMandantesReconciliationSummary(globalSession(), period),
    payables: await getPayablesSummary(costSession, period),
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-03-01", requestedTo: "2026-03-31", correlationId: "corr-pay" })
  await testDb.insert(schema.fuelSuppliers).values({ id: "sup-pay", name: "Copec" })

  // Marzo: transacciones dentro y fuera del período que se marcará (10 al 19), un TCT mensual
  // de otro equipo, entradas, cargas en terreno y cargas facturadas sin estado de cuenta.
  await testDb.insert(schema.fuelProviderTransactions).values([
    providerTx({ occurredAt: "2026-03-12T14:00:00.000Z", quantity: 300 }),
    providerTx({ occurredAt: "2026-03-25T14:00:00.000Z", quantity: 200 }),
    providerTx({ vehicleId: IDS.vB, sourcePlate: "BB-0002", occurredAt: "2026-03-01", granularity: "period_aggregate", quantity: 310 }),
    providerTx({ sourceAccount: "tae:diesel", occurredAt: "2026-03-15T14:00:00.000Z", quantity: 40 }),
  ])
  await testDb.insert(schema.fuelSupplyInputs).values({
    id: "pay-in-1", supplyMediumId: IDS.mediumCmpc, worksiteId: IDS.wsA, occurredAt: "2026-03-05T12:00:00.000Z", month: "2026-03", liters: 1000, reference: "G-1",
  })
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission({ id: "pay-sub-1", loadingPointId: IDS.lpFixed, supplyMediumId: IDS.mediumCmpc, liters: 600, loadedAt: "2026-03-14T15:00:00.000Z", submittedAt: "2026-03-14T15:00:00.000Z" }),
    submission({ id: "pay-sub-2", loadingPointId: IDS.lpTank, supplyMediumId: IDS.mediumTct, liters: 450, loadedAt: "2026-03-22T15:00:00.000Z", submittedAt: "2026-03-22T15:00:00.000Z" }),
  ])
  await testDb.insert(schema.fuelEquipmentLoads).values([
    { id: "pay-l-1", source: "field", taeSubmissionId: "pay-sub-1", vehicleId: IDS.vA, worksiteId: IDS.wsA, supplyMediumId: IDS.mediumCmpc, occurredAt: "2026-03-14T15:00:00.000Z", month: "2026-03", liters: 600, performanceUnit: "liters_per_hour", performanceValue: 10, performanceStatus: "computed", reviewStatus: "ok" },
    { id: "pay-l-2", source: "field", taeSubmissionId: "pay-sub-2", vehicleId: IDS.vA, worksiteId: IDS.wsA, supplyMediumId: IDS.mediumTct, occurredAt: "2026-03-22T15:00:00.000Z", month: "2026-03", liters: 450, performanceUnit: "liters_per_hour", performanceValue: 11, performanceStatus: "computed", reviewStatus: "ok" },
  ])
  await testDb.insert(schema.fuelLoads).values([
    { id: "pay-fl-1", loadDate: "2026-03-13", month: "2026-03", serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: "sup-pay", worksiteId: IDS.wsA, product: "PETROLEO DIESEL", productId: IDS.product, liters: 50, baseAmount: 50_000, totalAmount: 59_500, status: "registered", createdBy: IDS.user },
    { id: "pay-fl-2", loadDate: "2026-03-27", month: "2026-03", serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: "sup-pay", worksiteId: IDS.wsA, product: "PETROLEO DIESEL", productId: IDS.product, liters: 30, baseAmount: 30_000, totalAmount: 35_700, status: "registered", createdBy: IDS.user },
  ])
}, 60_000)

describe("pagos y cuadratura con uso personal", () => {
  it("dan lo mismo antes de marcar, con el período marcado y después de quitarlo", async () => {
    const before = await snapshot()
    // La prueba no sirve si la cuadratura o los pagos no ven nada del equipo.
    expect(before.payables.monthsWithoutStatement.length).toBeGreaterThan(0)

    await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
      { id: "pay-pu-a", vehicleId: IDS.vA, startedOn: "2026-03-10", endedOn: "2026-03-19" },
      { id: "pay-pu-b", vehicleId: IDS.vB, startedOn: "2026-03-20", endedOn: null },
    ])
    expect(await snapshot()).toEqual(before)

    await testDb.delete(schema.fuelVehiclePersonalUsePeriods).where(eq(schema.fuelVehiclePersonalUsePeriods.vehicleId, IDS.vA))
    expect(await snapshot()).toEqual(before)
  })
})
