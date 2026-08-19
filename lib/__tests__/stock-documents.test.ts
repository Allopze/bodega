import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

const { countStockDocuments, getStockCountDetail, listStockDocuments } =
  await import("@/lib/services/stock-documents")

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
const now = new Date().toISOString()

describe("stock documents", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: "user-doc", name: "Bodeguero Doc", email: "doc@test.local",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-doc", name: "Faena Doc", code: "F-DOC", isActive: true, createdAt: now, updatedAt: now },
      { id: "ws-doc-other", name: "Faena Ajena", code: "F-AJENA", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-doc", name: "Cat Doc", slug: "cat-doc", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-doc", sku: "DOC-1", name: "Guante Doc", categoryId: "cat-doc",
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })

    // Un documento de cada tipo, en fechas distintas para poder fijar el orden.
    await inMemoryDb.insert(schema.stockAdjustments).values([
      {
        id: "aju-1", code: "AJU-2026-0001", kind: "ajuste", worksiteId: "ws-doc",
        productId: "prod-doc", quantity: -2, reason: "Merma", createdBy: "user-doc",
        createdAt: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "des-1", code: "DES-2026-0001", kind: "desecho", worksiteId: "ws-doc",
        productId: "prod-doc", quantity: -5, reason: "Dañado en faena", createdBy: "user-doc",
        createdAt: "2026-03-02T10:00:00.000Z",
      },
      {
        id: "aju-ajena", code: "AJU-2026-0009", kind: "ajuste", worksiteId: "ws-doc-other",
        productId: "prod-doc", quantity: -1, reason: "Fuera de alcance", createdBy: "user-doc",
        createdAt: "2026-03-05T10:00:00.000Z",
      },
    ])
    await inMemoryDb.insert(schema.stockReturns).values({
      id: "dev-1", code: "DEV-2026-0001", worksiteId: "ws-doc", productId: "prod-doc",
      quantity: 3, reason: "Sobrante de entrega", createdBy: "user-doc",
      createdAt: "2026-03-03T10:00:00.000Z",
    })
    await inMemoryDb.insert(schema.physicalInventoryCounts).values({
      id: "con-1", code: "CON-2026-0001", worksiteId: "ws-doc", status: "closed",
      countedBy: "user-doc", closedBy: "user-doc", closedAt: "2026-03-04T10:00:00.000Z",
      notes: "Cierre mensual", createdAt: "2026-03-04T09:00:00.000Z", updatedAt: "2026-03-04T10:00:00.000Z",
    })
    await inMemoryDb.insert(schema.physicalInventoryCountItems).values({
      id: "con-item-1", countId: "con-1", productId: "prod-doc",
      expectedQuantity: 10, countedQuantity: 8, difference: -2, notes: "Faltan 2",
    })
    // Cancelado: no es un papel que movió stock, no debe listarse.
    await inMemoryDb.insert(schema.physicalInventoryCounts).values({
      id: "con-cancel", code: "CON-2026-0002", worksiteId: "ws-doc", status: "cancelled",
      countedBy: "user-doc", createdAt: "2026-03-06T09:00:00.000Z", updatedAt: "2026-03-06T09:00:00.000Z",
    })
  })

  afterAll(async () => { await pg.close() })

  it("lista los cuatro tipos con su folio en una sola consulta", async () => {
    const rows = await listStockDocuments({ worksiteIds: ["ws-doc"] })

    expect(rows.map((row) => row.folio)).toEqual([
      "CON-2026-0001", "DEV-2026-0001", "DES-2026-0001", "AJU-2026-0001",
    ])
    expect(rows.map((row) => row.kind)).toEqual(["conteo", "devolucion", "desecho", "ajuste"])
  })

  it("ordena por fecha cruzando las tres tablas de origen", async () => {
    const rows = await listStockDocuments({ worksiteIds: ["ws-doc"] })
    const fechas = rows.map((row) => row.at.slice(0, 10))

    expect(fechas).toEqual([...fechas].sort().reverse())
  })

  it("deja fuera los conteos anulados", async () => {
    const rows = await listStockDocuments({ worksiteIds: ["ws-doc"] })

    expect(rows.some((row) => row.folio === "CON-2026-0002")).toBe(false)
  })

  it("el alcance manda sobre el filtro: una faena ajena no aparece ni pidiéndola", async () => {
    const rows = await listStockDocuments({ worksiteIds: ["ws-doc"], faena: "ws-doc-other" })

    expect(rows).toEqual([])
    expect(await countStockDocuments({ worksiteIds: ["ws-doc"], faena: "ws-doc-other" })).toBe(0)
  })

  it("un rol global sí ve la faena ajena", async () => {
    const rows = await listStockDocuments({ worksiteIds: "all" })

    expect(rows.some((row) => row.folio === "AJU-2026-0009")).toBe(true)
  })

  it("sin alcance no devuelve nada", async () => {
    expect(await listStockDocuments({ worksiteIds: [] })).toEqual([])
  })

  it("filtra por tipo de documento", async () => {
    const rows = await listStockDocuments({ worksiteIds: ["ws-doc"], kind: "desecho" })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.folio).toBe("DES-2026-0001")
  })

  it("busca por folio, producto y motivo", async () => {
    expect((await listStockDocuments({ worksiteIds: ["ws-doc"], q: "DES-2026" }))[0]?.kind).toBe("desecho")
    expect((await listStockDocuments({ worksiteIds: ["ws-doc"], q: "Guante" })).length).toBeGreaterThan(0)
    expect((await listStockDocuments({ worksiteIds: ["ws-doc"], q: "Dañado" }))[0]?.folio).toBe("DES-2026-0001")
  })

  it("recorta por rango con el día 'hasta' inclusive", async () => {
    const rows = await listStockDocuments({
      worksiteIds: ["ws-doc"], desde: "2026-03-02", hasta: "2026-03-03",
    })

    expect(rows.map((row) => row.folio)).toEqual(["DEV-2026-0001", "DES-2026-0001"])
  })

  it("cuenta lo mismo que lista y pagina fuera de la unión", async () => {
    const total = await countStockDocuments({ worksiteIds: ["ws-doc"] })
    const firstPage = await listStockDocuments({ worksiteIds: ["ws-doc"], limit: 2, offset: 0 })
    const secondPage = await listStockDocuments({ worksiteIds: ["ws-doc"], limit: 2, offset: 2 })

    expect(total).toBe(4)
    expect(firstPage).toHaveLength(2)
    expect(secondPage).toHaveLength(2)
    expect(firstPage.map((r) => r.folio)).not.toEqual(secondPage.map((r) => r.folio))
  })

  it("el conteo trae su detalle con lo esperado, lo contado y la diferencia", async () => {
    const items = await getStockCountDetail("con-1", ["ws-doc"])

    expect(items).toEqual([{
      productName: "Guante Doc",
      productSku: "DOC-1",
      expectedQuantity: 10,
      countedQuantity: 8,
      difference: -2,
      notes: "Faltan 2",
    }])
  })

  it("el detalle también respeta el alcance", async () => {
    expect(await getStockCountDetail("con-1", ["ws-doc-other"])).toEqual([])
  })
})
