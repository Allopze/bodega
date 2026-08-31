import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { reconcileFuelProviderRun } = await import("@/lib/combustibles/fuel-reconciliation")

/**
 * Nadie escribía `fuel_reconciliation_links`: las funciones de conciliación
 * estaban exportadas sin un solo llamador, así que las dos métricas que el
 * preflight saca de esa tabla daban cero por falta de datos, no por estar todo
 * cuadrado. Estas pruebas fijan el cableado y el invariante que lo hace seguro.
 */
describe("conciliación de una corrida de proveedor", () => {
  const ids = {
    worksite: "ws-rec", user: "user-rec", supplier: "sup-rec", product: "prod-rec",
    equipmentType: "eqt-rec", vehicle: "veh-rec", run: "run-rec", transaction: "tx-rec",
  }

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: ids.worksite, name: "Faena", code: "FR-1", isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: ids.user, name: "U", email: "u-rec@example.com", hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: ids.supplier, name: "Copec", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: ids.product, code: "DIESEL-REC", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: ids.equipmentType, slug: "camion-rec", name: "Camión", category: "other", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: ids.vehicle, plate: "REC-99", type: "camion", equipmentTypeId: ids.equipmentType, worksiteId: ids.worksite, isActive: true })
    await inMemoryDb.insert(schema.fuelProviderSyncRuns).values({ id: ids.run, provider: "copec", requestedFrom: "2026-07-01", requestedTo: "2026-07-31", correlationId: "corr-rec" })
    await inMemoryDb.insert(schema.fuelProviderTransactions).values({
      id: ids.transaction, syncRunId: ids.run, provider: "copec", sourceAccount: "tct:diesel",
      supplierId: ids.supplier, identityKey: "row:copec:tct:diesel:REC99", fingerprint: "fp", sourceRowKey: "rk",
      worksiteId: ids.worksite, vehicleId: ids.vehicle, productId: ids.product,
      occurredAt: "2026-07-15", quantity: 100, amount: 90_000, status: "accepted", payloadHash: "ph",
    })
  })

  async function links() {
    return inMemoryDb.query.fuelReconciliationLinks.findMany({
      where: eq(schema.fuelReconciliationLinks.providerTransactionId, ids.transaction),
    })
  }

  it("deja exactamente un vínculo por tipo, aunque se repita la corrida", async () => {
    // El índice único incluye las columnas de destino, y en PostgreSQL los NULL
    // son distintos entre sí: con `onConflictDoNothing` cada corrida sin match
    // insertaba una fila nueva y el conteo del preflight crecía para siempre.
    for (let attempt = 0; attempt < 3; attempt++) await reconcileFuelProviderRun(ids.run)

    const rows = await links()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.linkType).sort()).toEqual(["cycle_movement", "fuel_load"])
    for (const row of rows) expect(row.status).toBe("unmatched")
  })

  it("reemplaza el vínculo sin match por el match cuando aparece la carga interna", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: "load-rec", loadDate: "2026-07-15", month: "2026-07", serviceType: "TCT",
      vehicleId: ids.vehicle, fuelSupplierId: ids.supplier, worksiteId: ids.worksite,
      product: "PETROLEO DIESEL", productId: ids.product,
      liters: 100, baseAmount: 90_000, totalAmount: 90_000, createdBy: ids.user,
    })

    const outcome = await reconcileFuelProviderRun(ids.run)

    expect(outcome).toMatchObject({ reconciled: 1, matched: 1 })
    const rows = await links()
    // Sigue habiendo dos, no cuatro: el `matched` reemplaza al `unmatched`.
    expect(rows).toHaveLength(2)
    const fuelLoadLink = rows.find((row) => row.linkType === "fuel_load")
    expect(fuelLoadLink).toMatchObject({ status: "matched", fuelLoadId: "load-rec" })
  })

  it("ignora las transacciones pendientes, que no tienen contra qué compararse", async () => {
    await inMemoryDb.insert(schema.fuelProviderTransactions).values({
      id: "tx-pendiente", syncRunId: ids.run, provider: "copec", sourceAccount: "tct:diesel",
      identityKey: "row:copec:tct:diesel:SINMAP", fingerprint: "fp2", sourceRowKey: "rk2",
      occurredAt: "2026-07-16", quantity: 50, amount: 45_000, status: "pending",
      resolutionCode: "unresolved_mapping", payloadHash: "ph2",
    })

    const outcome = await reconcileFuelProviderRun(ids.run)

    expect(outcome.reconciled).toBe(1)
    const pendingLinks = await inMemoryDb.query.fuelReconciliationLinks.findMany({
      where: eq(schema.fuelReconciliationLinks.providerTransactionId, "tx-pendiente"),
    })
    expect(pendingLinks).toHaveLength(0)
  })

  it("salta la evidencia agregada en vez de darle un veredicto que no significa nada", async () => {
    // El informe TCT de Copec es un agregado MENSUAL por patente: su fila se
    // fecha al día 1 y suma todas las cargas del mes, así que el matcher —que
    // exige misma fecha civil y litros/monto dentro de tolerancia— le daba
    // `unmatched` siempre. Eso decía "descuadre" donde sólo había
    // granularidades distintas, e inflaba `unmatched_reconciliation_links`.
    await inMemoryDb.insert(schema.fuelProviderTransactions).values({
      id: "tx-agregada", syncRunId: ids.run, provider: "copec", sourceAccount: "tct:diesel",
      supplierId: ids.supplier, identityKey: "row:copec:tct:diesel:AGREGADA", fingerprint: "fp3", sourceRowKey: "rk3",
      worksiteId: ids.worksite, vehicleId: ids.vehicle, productId: ids.product,
      occurredAt: "2026-07-01", quantity: 320, amount: 288_000, status: "accepted",
      granularity: "period_aggregate", payloadHash: "ph3",
    })

    const outcome = await reconcileFuelProviderRun(ids.run)

    expect(outcome).toMatchObject({ reconciled: 1, skippedAggregates: 1 })
    const aggregateLinks = await inMemoryDb.query.fuelReconciliationLinks.findMany({
      where: eq(schema.fuelReconciliationLinks.providerTransactionId, "tx-agregada"),
    })
    expect(aggregateLinks).toHaveLength(0)
  })
})
