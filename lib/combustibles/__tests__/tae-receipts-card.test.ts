import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { ParsedTaeReceiptRow } from "../tae-receipt-import"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { importTaeReceipts } = await import("../tae-receipts")

function row(documentNumber: string, cardNumber: string): ParsedTaeReceiptRow {
  return {
    rowIndex: 1, documentNumber, cardNumber, assignment: "CHOLGUAN", productId: "fuel-diesel",
    sourceDate: "2026-01-10", occurredAt: "2026-01-10T13:00:00.000Z",
    liters: 500, unitPrice: 1000, amount: 500_000, station: "Copec Ruta 5", rawRow: {},
  }
}

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, fuel_cycle_movements, fuel_storage_locations, fuel_suppliers, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Importador", email: "i@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values({ id: "w-cho", name: "Cholguan - Arauco", code: "CHOLGUAN-ARAUCO", isActive: true })
  await testDb.insert(schema.fuelProducts).values({ id: "fuel-diesel", code: "fuel-diesel", name: "Diésel" }).onConflictDoNothing()
  await testDb.insert(schema.fuelSuppliers).values({ id: "fs-copec", name: "Copec S.A.", isActive: true })
})

// La tarjeta puede guardarse con o sin guiones en la vasija, y el informe la
// trae con guiones: la recepción tiene que encontrar su vasija igual.
describe("las recepciones TAE encuentran su vasija sin importar el formato de la tarjeta", () => {
  it("vasija con guiones, recepción con guiones", async () => {
    await testDb.insert(schema.fuelStorageLocations).values({ id: "loc-1", worksiteId: "w-cho", productId: "fuel-diesel", name: "Vasija Cholguán", taeCardNumber: "1-242269-00230-9-1" })
    const outcome = await importTaeReceipts([row("G-1", "1-242269-00230-9-1")], "u-1")
    expect(outcome).toMatchObject({ inserted: 1, unmappedCards: [] })
  })

  it("vasija sin guiones, recepción con guiones", async () => {
    await testDb.insert(schema.fuelStorageLocations).values({ id: "loc-1", worksiteId: "w-cho", productId: "fuel-diesel", name: "Vasija Cholguán", taeCardNumber: "12422690023091" })
    const outcome = await importTaeReceipts([row("G-1", "1-242269-00230-9-1")], "u-1")
    expect(outcome).toMatchObject({ inserted: 1, unmappedCards: [] })
  })

  it("una tarjeta sin vasija sigue reportada como sin estanque", async () => {
    const outcome = await importTaeReceipts([row("G-1", "1-242269-00258-9-8")], "u-1")
    expect(outcome).toMatchObject({ inserted: 0, unmappedCards: ["1-242269-00258-9-8"] })
  })
})
