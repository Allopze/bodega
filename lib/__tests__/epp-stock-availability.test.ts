/**
 * EPP stock preflight — physical stock is scoped to the request worksite.
 *
 * This uses PGlite instead of mocks so the reader proves the same joins,
 * ordering and worksite/product lifecycle guards used by the transaction that
 * creates the request.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import {
  EppStockAvailabilityError,
  getEppStockWarnings,
  readEppStockAvailability,
} from "@/lib/services/epp-stock-availability"

const now = new Date().toISOString()
const worksiteId = "ws-epp-stock"

function requested(items: Array<{ productId: string | null; quantity: number }>, targetWorksiteId = worksiteId) {
  return {
    worksiteId: targetWorksiteId,
    items: items.map((item) => ({ ...item, productNameFree: null })),
  }
}

describe("readEppStockAvailability", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-epp-stock", name: "EPP stock", slug: "cat-epp-stock", isEpp: true,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena Stock EPP", code: "EPP-STOCK", isActive: true, createdAt: now, updatedAt: now },
      { id: "ws-epp-other", name: "Otra faena", code: "EPP-OTHER", isActive: true, createdAt: now, updatedAt: now },
      { id: "ws-epp-inactive", name: "Faena cerrada", code: "EPP-CLOSED", isActive: false, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.products).values([
      { id: "prod-epp-casco", sku: "EPP-CASCO", name: "Casco de seguridad", categoryId: "cat-epp-stock", isEpp: true, isActive: true, createdAt: now, updatedAt: now },
      { id: "prod-epp-casco-m", sku: "EPP-CASCO-M", name: "Casco de seguridad talla M", categoryId: "cat-epp-stock", isEpp: true, isActive: true, createdAt: now, updatedAt: now },
      { id: "prod-epp-cero", sku: "EPP-CERO", name: "Guantes sin saldo", categoryId: "cat-epp-stock", isEpp: true, isActive: true, createdAt: now, updatedAt: now },
      { id: "prod-epp-inactivo", sku: "EPP-OFF", name: "EPP inactivo", categoryId: "cat-epp-stock", isEpp: true, isActive: false, createdAt: now, updatedAt: now },
      { id: "prod-no-epp", sku: "NO-EPP", name: "Insumo no EPP", categoryId: "cat-epp-stock", isEpp: false, isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.worksiteStock).values([
      { id: "stock-epp-casco", worksiteId, productId: "prod-epp-casco", quantity: 5, minStock: 0, updatedAt: now },
      { id: "stock-epp-casco-m", worksiteId, productId: "prod-epp-casco-m", quantity: 2, minStock: 0, updatedAt: now },
      // A positive balance in another worksite must never trigger a warning.
      { id: "stock-epp-other", worksiteId: "ws-epp-other", productId: "prod-epp-cero", quantity: 7, minStock: 0, updatedAt: now },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("adds repeated EPP lines and reports total and partial coverage per concrete product", async () => {
    const availability = await readEppStockAvailability(inMemoryDb, requested([
      { productId: "prod-epp-casco", quantity: 2 },
      { productId: "prod-epp-casco", quantity: 3 },
      // Variants are independent catalog products, never attributes to merge.
      { productId: "prod-epp-casco-m", quantity: 5 },
    ]))

    expect(availability.snapshot.lines).toEqual([
      expect.objectContaining({ productId: "prod-epp-casco", requestedQuantity: 5, availableQuantity: 5 }),
      expect.objectContaining({ productId: "prod-epp-casco-m", requestedQuantity: 5, availableQuantity: 2 }),
    ])
    expect(getEppStockWarnings(availability.snapshot)).toEqual([
      expect.objectContaining({ productId: "prod-epp-casco", coverage: "total", locationName: "Faena Stock EPP" }),
      expect.objectContaining({ productId: "prod-epp-casco-m", coverage: "partial", locationName: "Faena Stock EPP" }),
    ])
  })

  it("returns no warning for zero stock or stock that only exists in another worksite", async () => {
    const availability = await readEppStockAvailability(inMemoryDb, requested([
      { productId: "prod-epp-cero", quantity: 1 },
    ]))

    expect(availability.snapshot.lines).toEqual([
      expect.objectContaining({ productId: "prod-epp-cero", availableQuantity: 0 }),
    ])
    expect(getEppStockWarnings(availability.snapshot)).toEqual([])
  })

  it("does not include non-EPP catalog items in stock availability", async () => {
    const availability = await readEppStockAvailability(inMemoryDb, requested([
      { productId: "prod-no-epp", quantity: 2 },
      { productId: null, quantity: 1 },
    ]))

    expect(availability.snapshot.lines).toEqual([])
  })

  it("fails closed when the selected worksite or a catalog product is no longer active", async () => {
    await expect(readEppStockAvailability(inMemoryDb, requested([
      { productId: "prod-epp-inactivo", quantity: 1 },
    ]))).rejects.toBeInstanceOf(EppStockAvailabilityError)

    await expect(readEppStockAvailability(inMemoryDb, requested([
      { productId: "prod-epp-casco", quantity: 1 },
    ], "ws-epp-inactive"))).rejects.toBeInstanceOf(EppStockAvailabilityError)
  })

  it("propagates an inventory query failure instead of treating it as zero stock", async () => {
    const failingReader = {
      select() { throw new Error("inventory unavailable") },
    } as unknown as DB

    await expect(readEppStockAvailability(failingReader, requested([
      { productId: "prod-epp-casco", quantity: 1 },
    ]))).rejects.toThrow("inventory unavailable")
  })
})
