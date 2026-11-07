import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getAssetFuelSummary } = await import("@/lib/combustibles/control/queries/asset-fuel-summary")

function session(options: { global?: boolean; worksiteIds?: string[]; costs?: boolean } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: options.global ?? true,
      roles: [],
      worksiteIds: options.worksiteIds ?? [],
      permissions: ["combustibles:view", ...(options.costs === false ? [] : ["combustibles:view_costs"])],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }
const APRIL = { from: "2026-04-01", to: "2026-04-30" }

let seq = 0

async function addLoad(input: {
  vehicle: string
  worksite: string
  at: string
  perf: number | null
  liters?: number
  review?: "ok" | "flagged" | "approved" | "rejected"
  voided?: boolean
  duplicateOf?: string | null
}): Promise<string> {
  seq += 1
  const id = `afs-load-${seq}`
  const sub = submission({
    id: `afs-sub-${seq}`,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    loadedAt: input.at,
    submittedAt: input.at,
    liters: input.liters ?? 100,
  })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id,
    source: "field",
    taeSubmissionId: sub.id,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    occurredAt: input.at,
    month: input.at.slice(0, 7),
    liters: input.liters ?? 100,
    accumulatedLiters: input.liters ?? 100,
    meterDelta: input.perf == null || input.perf <= 0 ? null : (input.liters ?? 100) / input.perf,
    performanceUnit: "liters_per_hour",
    performanceValue: input.perf,
    performanceStatus: input.perf === null ? "first_load" : "computed",
    reviewStatus: input.review ?? "ok",
    duplicateOfId: input.duplicateOf ?? null,
    voidedAt: input.voided ? "2026-03-12T00:00:00.000Z" : null,
  })
  return id
}

/**
 * Serie antigua (`fuel_loads`): el panel ya no lee el monto de acá. Se sigue
 * sembrando para probar que sus importes NO se cuelan en el agregado.
 */
async function addLegacyInvoice(input: {
  id: string
  vehicle: string
  worksite: string
  date: string
  amount: number
  status: "draft" | "registered" | "reconciled" | "cancelled"
}) {
  await testDb.insert(schema.fuelLoads).values({
    id: input.id,
    loadDate: input.date,
    month: input.date.slice(0, 7),
    serviceType: "TCT",
    vehicleId: input.vehicle,
    fuelSupplierId: "afs-supplier",
    worksiteId: input.worksite,
    product: "PETROLEO DIESEL",
    productId: IDS.product,
    liters: 100,
    baseAmount: input.amount,
    totalAmount: input.amount,
    status: input.status,
    createdBy: IDS.user,
  })
}

let txSeq = 0
/** Libro del proveedor: la serie canónica del monto del panel. */
async function addProviderTransaction(input: {
  vehicle: string
  worksite: string
  date: string
  amount: number
  quantity?: number
  status?: "accepted" | "pending" | "rejected" | "excluded" | "superseded"
}) {
  txSeq += 1
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `afs-tx-${txSeq}`,
    syncRunId: "afs-run",
    provider: "copec",
    sourceAccount: "tct:diesel",
    identityKey: `afs-idk-${txSeq}`,
    fingerprint: `afs-fp-${txSeq}`,
    sourceRowKey: `afs-row-${txSeq}`,
    payloadHash: `afs-ph-${txSeq}`,
    worksiteId: input.worksite,
    vehicleId: input.vehicle,
    sourcePlate: "AA-0001",
    occurredAt: input.date,
    quantity: input.quantity ?? 100,
    amount: input.amount,
    status: input.status ?? "accepted",
    granularity: "transaction",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.fuelSuppliers).values({ id: "afs-supplier", name: "Proveedor AFS" })
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "afs-run",
    provider: "copec",
    requestedFrom: "2026-03-01",
    requestedTo: "2026-03-31",
    correlationId: "corr-afs",
  })

  // vA marzo: 100 ok + 50 marcada + 40 aprobada + 60 original; la anulada, la
  // rechazada, la duplicada y la de febrero no cuentan.
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-05T15:00:00.000Z", perf: 20, liters: 100 })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-25T15:00:00.000Z", perf: 99, liters: 50, review: "flagged" })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-10T15:00:00.000Z", perf: 18, liters: 40, review: "approved" })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-12T15:00:00.000Z", perf: 30, liters: 30, voided: true })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-13T15:00:00.000Z", perf: 30, liters: 25, review: "rejected" })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-02-20T15:00:00.000Z", perf: 10, liters: 999 })
  const original = await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-15T15:00:00.000Z", perf: 19, liters: 60 })
  await addLoad({ vehicle: IDS.vA, worksite: IDS.wsA, at: "2026-03-15T15:05:00.000Z", perf: 19, liters: 60, duplicateOf: original })

  await addLoad({ vehicle: IDS.vB, worksite: IDS.wsB, at: "2026-03-06T15:00:00.000Z", perf: 15, liters: 200 })
  await addLoad({ vehicle: IDS.vC, worksite: IDS.wsC, at: "2026-03-07T15:00:00.000Z", perf: 10, liters: 999 })

  await testDb.insert(schema.fuelAnomalyRules).values({ id: "afs-rule", code: "afs_regla", name: "Regla AFS", severity: "high" })
  await testDb.insert(schema.fuelAnomalyCases).values([
    { id: "afs-case-1", ruleId: "afs-rule", ruleCode: "afs_regla", severity: "high", worksiteId: IDS.wsA, vehicleId: IDS.vA, referenceEntityType: "fuel_load", referenceEntityId: "afs-load-1", description: "Abierto alto", status: "open" },
    { id: "afs-case-2", ruleId: "afs-rule", ruleCode: "afs_regla", severity: "critical", worksiteId: IDS.wsA, vehicleId: IDS.vA, referenceEntityType: "fuel_load", referenceEntityId: "afs-load-2", description: "Abierto crítico", status: "in_review" },
    { id: "afs-case-3", ruleId: "afs-rule", ruleCode: "afs_regla", severity: "critical", worksiteId: IDS.wsA, vehicleId: IDS.vA, referenceEntityType: "fuel_load", referenceEntityId: "afs-load-3", description: "Resuelto", status: "resolved" },
    { id: "afs-case-4", ruleId: "afs-rule", ruleCode: "afs_regla", severity: "low", worksiteId: IDS.wsB, vehicleId: IDS.vB, referenceEntityType: "fuel_load", referenceEntityId: "afs-load-9", description: "De B", status: "open" },
    { id: "afs-case-5", ruleId: "afs-rule", ruleCode: "afs_regla", severity: "critical", worksiteId: IDS.wsC, vehicleId: IDS.vC, referenceEntityType: "fuel_load", referenceEntityId: "afs-load-10", description: "De C", status: "reopened" },
  ])

  // Serie antigua: importes distintos de los del proveedor. Si el panel volviera
  // a leer `fuel_loads`, el monto de vA sería 15.000 y no 16.000.
  await addLegacyInvoice({ id: "afs-inv-1", vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-05", amount: 10000, status: "registered" })
  await addLegacyInvoice({ id: "afs-inv-2", vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-10", amount: 5000, status: "reconciled" })
  await addLegacyInvoice({ id: "afs-inv-3", vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-11", amount: 9999, status: "cancelled" })
  await addLegacyInvoice({ id: "afs-inv-4", vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-12", amount: 7777, status: "draft" })
  await addLegacyInvoice({ id: "afs-inv-5", vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-02-28", amount: 8888, status: "registered" })
  await addLegacyInvoice({ id: "afs-inv-6", vehicle: IDS.vB, worksite: IDS.wsB, date: "2026-03-06", amount: 20000, status: "registered" })
  await addLegacyInvoice({ id: "afs-inv-7", vehicle: IDS.vC, worksite: IDS.wsC, date: "2026-03-07", amount: 30000, status: "registered" })

  // Libro del proveedor (la fuente que el panel debe usar): 16.000 / 21.000 / 31.000.
  await addProviderTransaction({ vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-05T15:00:00.000Z", amount: 12000 })
  await addProviderTransaction({ vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-10T15:00:00.000Z", amount: 4000 })
  // Una pendiente y una rechazada no son consumo: no deben sumar.
  await addProviderTransaction({ vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-11T15:00:00.000Z", amount: 99999, status: "pending" })
  await addProviderTransaction({ vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-03-12T15:00:00.000Z", amount: 88888, status: "rejected" })
  await addProviderTransaction({ vehicle: IDS.vA, worksite: IDS.wsA, date: "2026-02-28T15:00:00.000Z", amount: 77777 })
  await addProviderTransaction({ vehicle: IDS.vB, worksite: IDS.wsB, date: "2026-03-06T15:00:00.000Z", amount: 21000 })
  await addProviderTransaction({ vehicle: IDS.vC, worksite: IDS.wsC, date: "2026-03-07T15:00:00.000Z", amount: 31000 })

  // Telemetría de A y B en marzo: el % en vacío se recalcula desde las horas.
  await testDb.insert(schema.fuelTelemetryDaily).values([
    { id: "afs-tel-1", vehicleId: IDS.vA, source: "visionlink", day: "2026-03-02", month: "2026-03", operatingHours: 10, idleHours: 2, litersIdle: 12 },
    { id: "afs-tel-2", vehicleId: IDS.vB, source: "visionlink", day: "2026-03-02", month: "2026-03", operatingHours: 5, idleHours: 1 },
  ])
}, 120_000)

describe("getAssetFuelSummary", () => {
  it("agrega litros, rendimiento, cargas marcadas, casos y costo facturado por vehículo", async () => {
    const summary = await getAssetFuelSummary(session(), MARCH, [IDS.vA, IDS.vB, IDS.vC])

    expect(summary.get(IDS.vA)).toMatchObject({
      liters: 250,
      loadCount: 4,
      performanceValue: 19,
      flaggedLoads: 1,
      openCases: 2,
      criticalOpenCases: 1,
      // 16.000 del libro del proveedor, no 15.000 de `fuel_loads`.
      billedAmount: 16000,
      idleHours: 2,
      idlePct: 20,
      litersIdle: 12,
    })
    expect(summary.get(IDS.vA)?.lastLoadAt).toContain("2026-03-25")
    expect(summary.get(IDS.vB)).toMatchObject({
      liters: 200,
      loadCount: 1,
      performanceValue: 15,
      flaggedLoads: 0,
      openCases: 1,
      criticalOpenCases: 0,
      billedAmount: 21000,
      idlePct: 20,
    })
    expect(summary.get(IDS.vC)).toMatchObject({ liters: 999, performanceValue: 10, openCases: 1, criticalOpenCases: 1, billedAmount: 31000 })
  })

  it("sin permiso de costos no devuelve montos, pero sí el resto del agregado", async () => {
    const summary = await getAssetFuelSummary(session({ costs: false }), MARCH, [IDS.vA])

    expect(summary.get(IDS.vA)).toMatchObject({ liters: 250, performanceValue: 19, billedAmount: null })
  })

  it("el alcance por faena recorta cargas, casos y costo de los equipos ajenos", async () => {
    const summary = await getAssetFuelSummary(
      session({ global: false, worksiteIds: [IDS.wsA] }),
      MARCH,
      [IDS.vA, IDS.vB, IDS.vC],
    )

    expect(summary.get(IDS.vA)).toMatchObject({ liters: 250, openCases: 2, billedAmount: 16000 })
    expect(summary.get(IDS.vB)).toMatchObject({ liters: 0, loadCount: 0, openCases: 0, billedAmount: null })
    expect(summary.get(IDS.vC)).toMatchObject({ liters: 0, loadCount: 0, openCases: 0, billedAmount: null })
  })

  it("el período excluye las cargas y facturas de otros meses", async () => {
    const summary = await getAssetFuelSummary(session(), APRIL, [IDS.vA])

    expect(summary.get(IDS.vA)).toMatchObject({
      liters: 0,
      loadCount: 0,
      performanceValue: null,
      flaggedLoads: 0,
      billedAmount: null,
      idleHours: 0,
      idlePct: null,
      litersIdle: null,
      // Los casos abiertos no dependen del período: siguen vigentes.
      openCases: 2,
      criticalOpenCases: 1,
    })
  })

  it("devuelve una entrada explícita para un vehículo sin datos", async () => {
    const summary = await getAssetFuelSummary(session(), MARCH, ["no-existe"])

    expect(summary.get("no-existe")).toMatchObject({
      liters: 0,
      loadCount: 0,
      lastLoadAt: null,
      performanceValue: null,
      flaggedLoads: 0,
      openCases: 0,
      criticalOpenCases: 0,
      billedAmount: null,
    })
  })
})
