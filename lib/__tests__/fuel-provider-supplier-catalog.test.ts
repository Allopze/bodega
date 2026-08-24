import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

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

const { recordFuelProviderValidation, beginFuelProviderSyncRun } = await import("@/lib/combustibles/fuel-provider-ledger")
import type { ProviderValidationResult } from "@/lib/combustibles/provider-validation"

/**
 * El id de `fuel_suppliers` estaba hardcodeado (`fs-aramco`, `fs-copec`) contra
 * un seed que ningún entorno ejecuta, así que TODA fila de una corrida moría con
 * violación de FK. La prueba fija el contrato nuevo: el proveedor sale del
 * catálogo, y si no está la fila se guarda sin proveedor en vez de perder la
 * corrida.
 */
function acceptedRow(externalId: string): ProviderValidationResult {
  return {
    accepted: [{
      provider: "aramco",
      accountKey: "fleet",
      sourceRowKey: externalId,
      externalId,
      identityKey: `external:${externalId}`,
      fingerprint: `fp-${externalId}`,
      occurredAt: "2026-07-21T18:31:26",
      plate: "RWYH93",
      sourceProduct: "Aramco ProForce Diesel B",
      product: "diesel",
      quantity: 37.4319,
      amount: 41207.44,
      unitPrice: 1100.8642,
      payload: { transactionId: Number(externalId) },
    }],
    rejected: [],
    pending: [],
  }
}

async function runFor(externalId: string) {
  const run = await beginFuelProviderSyncRun({
    provider: "aramco",
    trigger: "manual",
    requestedFrom: "2026-07-01",
    requestedTo: "2026-07-31",
  })
  await recordFuelProviderValidation(run.id, acceptedRow(externalId))
  const [row] = await inMemoryDb.select({ supplierId: schema.fuelProviderTransactions.supplierId })
    .from(schema.fuelProviderTransactions)
    .where(eq(schema.fuelProviderTransactions.identityKey, `external:${externalId}`))
  return row
}

describe("proveedor de las transacciones de integración", () => {
  const aramcoId = nanoid()

  beforeAll(async () => {
    // El catálogo real trae los proveedores que creó operación, con ids que el
    // código no puede adivinar.
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: nanoid(), name: "Copec", isActive: true })
  })

  it("guarda la fila sin proveedor cuando el catálogo todavía no lo tiene", async () => {
    expect((await runFor("16044915"))?.supplierId).toBeNull()
  })

  it("toma el id del catálogo, no una constante del código", async () => {
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: aramcoId, name: "ARAMCO", isActive: true })
    expect((await runFor("16044916"))?.supplierId).toBe(aramcoId)
  })

  it("un duplicado no degrada la fila aceptada que ya estaba en el ledger", async () => {
    // La identidad de una fila rechazada se calcula igual que la de una aceptada.
    // Un `duplicate_identity` —la segunda aparición de la misma identidad dentro
    // de la respuesta externa— caía sobre la fila buena por el upsert y le
    // cambiaba el estado y los montos por los del duplicado.
    const externalId = "16044918"
    const run = await beginFuelProviderSyncRun({ provider: "aramco", trigger: "manual", requestedFrom: "2026-07-01", requestedTo: "2026-07-31" })
    const result = acceptedRow(externalId)
    const accepted = result.accepted[0]!
    result.rejected = [{
      sourceRowKey: accepted.sourceRowKey,
      code: "duplicate_identity",
      message: `La identidad ${accepted.identityKey} se repite dentro de la respuesta externa`,
      input: {
        provider: "aramco",
        accountKey: accepted.accountKey,
        sourceRowKey: accepted.sourceRowKey,
        externalId,
        occurredAt: accepted.occurredAt,
        plate: accepted.plate,
        product: accepted.sourceProduct,
        quantity: 999,
        amount: 999,
        payload: {},
      },
    }]

    await recordFuelProviderValidation(run.id, result, () => ({ worksiteId: null, vehicleId: null, productId: null }))

    const [row] = await inMemoryDb.select({
      status: schema.fuelProviderTransactions.status,
      quantity: schema.fuelProviderTransactions.quantity,
      resolutionCode: schema.fuelProviderTransactions.resolutionCode,
    }).from(schema.fuelProviderTransactions)
      .where(eq(schema.fuelProviderTransactions.identityKey, `external:${externalId}`))

    // Sin mapping la fila válida queda `pending`, no `accepted`: lo que se prueba
    // es que el duplicado no la pisó con sus propios montos ni con su código.
    expect(row?.status).toBe("pending")
    expect(row?.resolutionCode).toBe("unresolved_mapping")
    expect(Number(row?.quantity)).toBe(37.4319)
  })

  it("ignora proveedores desactivados", async () => {
    await inMemoryDb.update(schema.fuelSuppliers).set({ isActive: false }).where(eq(schema.fuelSuppliers.id, aramcoId))
    expect((await runFor("16044917"))?.supplierId).toBeNull()
  })
})
