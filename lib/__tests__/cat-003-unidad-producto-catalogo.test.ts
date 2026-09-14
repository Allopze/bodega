/**
 * `CAT-003` (auditoría 2026-09-14) — el catálogo de unidades restringe de verdad
 * la unidad del producto.
 *
 * Antes: `product_units` era un catálogo administrable completo (código,
 * etiqueta, orden, activo) y `products.unit_of_measure` era texto libre
 * validado sólo por largo. Nada comprobaba que la unidad existiera en el
 * catálogo ni que siguiera activa, así que el catálogo era una sugerencia: el
 * importador XLSX escribía el texto crudo de la planilla y así entraron a
 * producción las unidades que la migración 0229 tuvo que sanear a mano.
 *
 * La corrección tiene dos mitades y esta prueba fija las dos:
 *  1. **Existir** — FK en base (migración 0307). Alcanza a todo camino de
 *     escritura, incluidos los importadores masivos y los scripts, que es
 *     justo lo que una validación sólo-zod no puede hacer.
 *  2. **Estar activa** — no lo puede expresar una FK; se comprueba al escribir.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
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

import { importProductsFromXlsx } from "@/lib/services/product-xlsx-import"
import { resolveActiveUnitCode } from "@/lib/services/product-unit-catalog"

const now = new Date().toISOString()
const CATEGORY = "cat-cat003"

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("EPP")
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("CAT-003 — la unidad del producto sale del catálogo de unidades", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.productCategories).values({
      id: CATEGORY, name: "EPP CAT-003", slug: "epp-cat003", sortOrder: 0,
    })
  })

  afterAll(async () => { await pg.close() })

  it("la base rechaza un producto con una unidad que no está en el catálogo", async () => {
    await expect(inMemoryDb.insert(schema.products).values({
      id: "p-cat003-malo", sku: "CAT003-1", name: "Producto con unidad inventada",
      categoryId: CATEGORY, unitOfMeasure: "cajitas", isActive: true, createdAt: now, updatedAt: now,
    })).rejects.toThrow()
  })

  it("acepta una unidad sembrada en el catálogo", async () => {
    await inMemoryDb.insert(schema.products).values({
      id: "p-cat003-bueno", sku: "CAT003-2", name: "Producto con unidad de catálogo",
      categoryId: CATEGORY, unitOfMeasure: "caja", isActive: true, createdAt: now, updatedAt: now,
    })
    const row = await inMemoryDb.query.products.findFirst({ where: eq(schema.products.id, "p-cat003-bueno") })
    expect(row?.unitOfMeasure).toBe("caja")
  })

  it("el importador masivo rechaza la fila y dice cuál es, en vez de reventar con un error del driver", async () => {
    const buffer = await workbookBuffer([
      ["SKU", "Nombre", "Unidad"],
      ["CAT003-IMP-1", "Casco importado", "unidad"],
      ["CAT003-IMP-2", "Guante importado", "Cajas "],
    ])

    const result = await importProductsFromXlsx(buffer)

    expect(result.created).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Fila 3")
    expect(result.errors[0]).toContain("cajas")
    // Nada se escribió: el importador es todo-o-nada.
    const imported = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.sku, "CAT003-IMP-1"),
    })
    expect(imported).toBeUndefined()
  })

  it("el importador normaliza la caja y los espacios de una unidad que sí está en el catálogo", async () => {
    const buffer = await workbookBuffer([
      ["SKU", "Nombre", "Unidad"],
      ["CAT003-IMP-3", "Bidón importado", " BIDON "],
    ])

    const result = await importProductsFromXlsx(buffer)

    expect(result.errors).toEqual([])
    expect(result.created).toBe(1)
    const imported = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.sku, "CAT003-IMP-3"),
    })
    expect(imported?.unitOfMeasure).toBe("bidon")
  })

  it("una unidad desactivada existe para la FK pero deja de ser elegible al escribir", async () => {
    await inMemoryDb.update(schema.productUnits)
      .set({ isActive: false })
      .where(eq(schema.productUnits.code, "tarro"))

    // La FK la sigue aceptando —y debe hacerlo: hay productos históricos que la
    // usan y borrar la fila del catálogo los dejaría huérfanos—.
    await inMemoryDb.insert(schema.products).values({
      id: "p-cat003-legacy", sku: "CAT003-3", name: "Producto histórico",
      categoryId: CATEGORY, unitOfMeasure: "tarro", isActive: true, createdAt: now, updatedAt: now,
    })

    // Lo que ya no se puede es elegirla para una escritura nueva.
    await expect(resolveActiveUnitCode("tarro")).rejects.toThrow(/catálogo de unidades/)
  })
})
