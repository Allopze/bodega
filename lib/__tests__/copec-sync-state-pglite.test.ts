import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime; sólo difiere el HKT del driver.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getCopecSyncStartOptions, setCopecSyncStartDate } = await import("@/lib/combustibles/copec-sync")
const { getCopecSyncDetectionEvidence } = await import("@/lib/combustibles/fuel-provider-ledger")
const { readFuelVariationReconciliationSnapshot } = await import("@/scripts/reconcile-fuel-variation-cases")

describe("persistencia inicial del cursor Copec", () => {
  it("inserta el primer estado sin castear una versión vacía a timestamptz", async () => {
    const before = await getCopecSyncStartOptions()

    await expect(setCopecSyncStartDate(before.currentStart, before.currentStart)).resolves.toMatchObject({
      currentStart: before.currentStart,
    })

    const row = await inMemoryDb.query.systemSettings.findFirst({
      where: eq(schema.systemSettings.key, "combustibles.copec.sync"),
    })
    expect(row).toBeDefined()
    expect(JSON.parse(row!.value)).toMatchObject({ cursor: null, requestedStart: before.currentStart })
  })
})

describe("evidencia de importación Copec al iniciar detección", () => {
  it("lee la última corrida previa y distingue si terminó antes del detector", async () => {
    await inMemoryDb.insert(schema.fuelProviderSyncRuns).values([
      {
        id: "copec-completed-previous-day", provider: "copec", trigger: "cron", requestedFrom: "2026-09-01", requestedTo: "2026-09-30",
        correlationId: "corr-previous-day", status: "success", rowsAccepted: 25,
        startedAt: "2026-11-01T12:00:00.000Z", finishedAt: "2026-11-01T12:05:00.000Z",
      },
      {
        id: "copec-completed-before", provider: "copec", trigger: "cron", requestedFrom: "2026-10-01", requestedTo: "2026-10-31",
        correlationId: "corr-before", status: "success", rowsAccepted: 12,
        startedAt: "2026-11-02T05:30:00.000Z", finishedAt: "2026-11-02T05:35:00.000Z",
      },
      {
        id: "copec-started-after", provider: "copec", trigger: "cron", requestedFrom: "2026-10-01", requestedTo: "2026-10-31",
        correlationId: "corr-after", status: "running", rowsAccepted: 0,
        startedAt: "2026-11-02T07:00:00.000Z",
      },
    ])

    await expect(getCopecSyncDetectionEvidence("2026-11-02T06:30:00.000Z")).resolves.toEqual({
      status: "success",
      startedAt: "2026-11-02T05:30:00.000Z",
      finishedAt: "2026-11-02T05:35:00.000Z",
      rowsAccepted: 12,
      completedBeforeDetection: true,
    })

    await expect(getCopecSyncDetectionEvidence("2026-11-02T05:32:00.000Z")).resolves.toMatchObject({
      status: "success",
      finishedAt: "2026-11-02T05:35:00.000Z",
      completedBeforeDetection: false,
    })

    await expect(getCopecSyncDetectionEvidence("2026-11-03T06:30:00.000Z")).resolves.toEqual({
      status: null,
      startedAt: null,
      finishedAt: null,
      rowsAccepted: 0,
      completedBeforeDetection: false,
    })
  })
})

describe("conciliación histórica de variaciones", () => {
  it("abre una transacción de solo lectura y deja intactos los casos y registros", async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "readonly-worksite", name: "Solo lectura", code: "RO-01" })
    await inMemoryDb.insert(schema.users).values({ id: "readonly-user", name: "Lector", email: "readonly@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "readonly-type", slug: "readonly-truck", name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: "readonly-vehicle", plate: "READONLY", type: "camion", equipmentTypeId: "readonly-type", worksiteId: "readonly-worksite",
    })
    await inMemoryDb.insert(schema.fuelImportBatches).values({
      id: "readonly-batch", worksiteId: "readonly-worksite", fuente: "Copec TCT Diesel", periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-31", archivoNombre: "readonly.xlsx", hashArchivo: "readonly-hash", importadoPor: "readonly-user",
    })
    await inMemoryDb.insert(schema.fuelConsumptionRecords).values([
      {
        id: "readonly-june", batchId: "readonly-batch", worksiteId: "readonly-worksite", vehicleId: "readonly-vehicle",
        patente: "READONLY", cantidadUnidad: 100, monto: 50_000, periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
        fuente: "Copec TCT Diesel", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "readonly-july", batchId: "readonly-batch", worksiteId: "readonly-worksite", vehicleId: "readonly-vehicle",
        patente: "READONLY", cantidadUnidad: 160, monto: 80_000, periodoDesde: "2026-07-01", periodoHasta: "2026-07-31",
        fuente: "Copec TCT Diesel", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ])
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({
      id: "readonly-rule", code: "variacion_brusca_consumo", name: "Variación", severity: "medium", config: "{\"thresholdPct\":50}",
    })
    await inMemoryDb.insert(schema.fuelAnomalyCases).values([
      {
        id: "readonly-open-case", ruleId: "readonly-rule", ruleCode: "variacion_brusca_consumo", severity: "medium",
        worksiteId: "readonly-worksite", vehicleId: "readonly-vehicle", referenceEntityType: "fuel_consumption_record",
        referenceEntityId: "readonly-vehicle:2026-07-01", description: "Caso abierto", observedValue: "+60%", status: "open",
      },
      {
        id: "readonly-resolved-case", ruleId: "readonly-rule", ruleCode: "variacion_brusca_consumo", severity: "medium",
        worksiteId: "readonly-worksite", vehicleId: "readonly-vehicle", referenceEntityType: "fuel_consumption_record",
        referenceEntityId: "readonly-vehicle:2026-06-01", description: "Caso resuelto", observedValue: "+10%", status: "resolved",
      },
    ])

    const beforeRecords = await inMemoryDb.select({ id: schema.fuelConsumptionRecords.id, cantidad: schema.fuelConsumptionRecords.cantidadUnidad, updatedAt: schema.fuelConsumptionRecords.updatedAt })
      .from(schema.fuelConsumptionRecords).orderBy(asc(schema.fuelConsumptionRecords.id))
    const beforeCases = await inMemoryDb.select({ id: schema.fuelAnomalyCases.id, status: schema.fuelAnomalyCases.status, reference: schema.fuelAnomalyCases.referenceEntityId })
      .from(schema.fuelAnomalyCases).orderBy(asc(schema.fuelAnomalyCases.id))
    const beforeExecutions = await inMemoryDb.select({ id: schema.fuelAnomalyExecutions.id }).from(schema.fuelAnomalyExecutions)

    await expect(readFuelVariationReconciliationSnapshot()).resolves.toMatchObject({
      recordCount: 2,
      legacyCases: expect.arrayContaining([
        expect.objectContaining({ referenceEntityId: "readonly-vehicle:2026-07-01", status: "open" }),
        expect.objectContaining({ referenceEntityId: "readonly-vehicle:2026-06-01", status: "resolved" }),
      ]),
      legacyStatusCounts: { open: 1, resolved: 1 },
      openQueueCounts: { variacion_brusca_consumo: 1 },
      unclassifiedRecords: 0,
      reconciliation: { sameProductMatch: 1, noCorrectedCandidate: 1, total: 2 },
    })

    const afterRecords = await inMemoryDb.select({ id: schema.fuelConsumptionRecords.id, cantidad: schema.fuelConsumptionRecords.cantidadUnidad, updatedAt: schema.fuelConsumptionRecords.updatedAt })
      .from(schema.fuelConsumptionRecords).orderBy(asc(schema.fuelConsumptionRecords.id))
    const afterCases = await inMemoryDb.select({ id: schema.fuelAnomalyCases.id, status: schema.fuelAnomalyCases.status, reference: schema.fuelAnomalyCases.referenceEntityId })
      .from(schema.fuelAnomalyCases).orderBy(asc(schema.fuelAnomalyCases.id))
    const afterExecutions = await inMemoryDb.select({ id: schema.fuelAnomalyExecutions.id }).from(schema.fuelAnomalyExecutions)
    expect(afterRecords).toEqual(beforeRecords)
    expect(afterCases).toEqual(beforeCases)
    expect(afterExecutions).toEqual(beforeExecutions)
  })
})
