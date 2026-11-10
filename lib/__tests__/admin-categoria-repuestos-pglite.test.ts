/**
 * Catálogo de repuestos: la categoría sembrada «Repuestos» (slug `repuestos`)
 * es sólo del catálogo de repuestos.
 *
 * `/admin/productos` no la acepta para un producto común —ni al crear, ni al
 * editar, ni en el lote de variantes, ni al importar el Excel— y su slug no se
 * puede cambiar, porque `createSparePartTx` la busca por él.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof inMemoryDb }
testGlobal.__db = inMemoryDb

const mockAuthFn = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const {
  createProduct, updateProduct, createProductVariantBatch, importProductsFromXlsx, updateCategory, createCategory,
} = await import("@/app/(app)/admin/productos/actions")
const sparePartsCategory = await import("@/lib/products/spare-parts-category")
const catalog = await import("@/lib/services/spare-parts-catalog")
const { normalizeEppRow, confirmEppImportBatch } = await import("@/lib/services/epp-import")

const userId = nanoid()
const generalId = nanoid()
const SPARE_PARTS_CATEGORY_ID = "cat-repuestos"
const RESERVED = /sólo del catálogo de repuestos/

function session(): Session {
  return {
    user: {
      id: userId, name: "Admin", email: "admin@chome.cl",
      permissions: ["admin:products"], roles: ["administrador"],
      worksiteIds: [], isGlobal: true, isActive: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

function productForm(fields: Record<string, string>) {
  const fd = new FormData()
  fd.set("name", "Lubricante multiuso")
  fd.set("categoryId", generalId)
  fd.set("unitOfMeasure", "unidad")
  fd.set("isActive", "on")
  fd.set("attributesJson", "[]")
  fd.set("suppliersJson", "[]")
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

function categoryForm(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

async function workbookFile(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Productos")
  for (const row of rows) sheet.addRow(row)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const fd = new FormData()
  fd.set("file", new File([buffer], "productos.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }))
  return fd
}

const productsNamed = (name: string) =>
  inMemoryDb.select().from(schema.products).where(eq(schema.products.name, name))

const category = async (id: string) =>
  (await inMemoryDb.select().from(schema.productCategories).where(eq(schema.productCategories.id, id)))[0]

beforeAll(async () => {
  mockAuthFn.mockResolvedValue(session())
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({ id: generalId, name: "General", slug: `general-${nanoid(4).toLowerCase()}` })
})

describe("la categoría «Repuestos» no admite productos comunes", () => {
  it("la constante del módulo de cliente es la misma que usa el catálogo", () => {
    expect(sparePartsCategory.SPARE_PARTS_CATEGORY_SLUG).toBe(catalog.SPARE_PARTS_CATEGORY_SLUG)
  })

  it("la migración la sembró con el slug que se reserva", async () => {
    expect(await category(SPARE_PARTS_CATEGORY_ID)).toMatchObject({ slug: "repuestos" })
  })

  it("crear un producto en «Repuestos» se rechaza en el servidor", async () => {
    const result = await createProduct({ ok: false }, productForm({
      name: "Producto mal ubicado", categoryId: SPARE_PARTS_CATEGORY_ID,
    }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.categoryId?.[0]).toMatch(RESERVED)
    expect(await productsNamed("Producto mal ubicado")).toHaveLength(0)
  })

  it("crear en otra categoría sigue funcionando", async () => {
    const result = await createProduct({ ok: false }, productForm({ name: "Producto bien ubicado" }))
    expect(result.ok).toBe(true)
    expect(await productsNamed("Producto bien ubicado")).toHaveLength(1)
  })

  it("mover un producto existente a «Repuestos» se rechaza", async () => {
    const id = nanoid()
    await inMemoryDb.insert(schema.products).values({
      id, sku: `GEN-${nanoid(6).toUpperCase()}`, name: "Grasa", categoryId: generalId, unitOfMeasure: "unidad", isActive: true,
    })
    const result = await updateProduct({ ok: false }, productForm({ id, name: "Grasa", categoryId: SPARE_PARTS_CATEGORY_ID }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.categoryId?.[0]).toMatch(RESERVED)
    expect((await productsNamed("Grasa"))[0]?.categoryId).toBe(generalId)
  })

  it("el lote de variantes tampoco la acepta", async () => {
    const result = await createProductVariantBatch({
      familyName: "Cable de prueba", categoryId: SPARE_PARTS_CATEGORY_ID, unitOfMeasure: "unidad",
      isEpp: false, requiresPrevencion: false, isActive: true,
      attributes: [{ name: "Largo", type: "select", options: "2m", sortOrder: 0 }],
      variants: [{ name: "Cable de prueba 2m", attributes: [{ name: "Largo", value: "2m" }] }],
      supplier: {},
    } as unknown as Parameters<typeof createProductVariantBatch>[0])
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toMatch(RESERVED)
    const rows = await inMemoryDb.select().from(schema.products).where(eq(schema.products.categoryId, SPARE_PARTS_CATEGORY_ID))
    expect(rows.filter((row) => !row.isSparePart)).toHaveLength(0)
  })

  it("el Excel con categoría «Repuestos» se rechaza completo y no escribe nada", async () => {
    const result = await importProductsFromXlsx({ ok: false }, await workbookFile([
      ["Nombre", "Categoría", "Unidad"],
      ["Importado bien", "General importada", "unidad"],
      ["Importado mal", "Repuestos", "unidad"],
    ]))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(RESERVED)
    expect(result.message).toContain("Fila 3")
    expect(await productsNamed("Importado bien")).toHaveLength(0)
    expect(await productsNamed("Importado mal")).toHaveLength(0)
  })

  it("el Excel no puede reescribir un repuesto por su ID", async () => {
    const part = await inMemoryDb.transaction((tx) => catalog.createSparePartTx(tx as never, {
      name: "Filtro de aire", partNumber: "AF-1", unitOfMeasure: "unidad", createdByUserId: userId,
    }))
    const result = await importProductsFromXlsx({ ok: false }, await workbookFile([
      ["ID", "Nombre", "Categoría", "Unidad"],
      [part.id, "Filtro renombrado", "General importada", "unidad"],
    ]))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Catálogo de repuestos/)
    const [row] = await inMemoryDb.select().from(schema.products).where(eq(schema.products.id, part.id))
    expect(row).toMatchObject({ name: "Filtro de aire", categoryId: SPARE_PARTS_CATEGORY_ID })
  })

  it("el importador de EPP tampoco la acepta como categoría", async () => {
    const normalized = normalizeEppRow({ name: "Casco blanco clase A", unitOfMeasure: "unidad", categoryName: "Repuestos" })
    const batchId = nanoid()
    await inMemoryDb.insert(schema.eppImportBatches).values({
      id: batchId, fileName: "epp.xlsx", fileHash: nanoid(), status: "review", sourceFileData: "", createdBy: userId,
    })
    await inMemoryDb.insert(schema.eppImportRows).values({
      id: nanoid(), batchId, rowNumber: 2, originalJson: "{}", normalizedJson: JSON.stringify(normalized), decision: "create",
    })
    await expect(confirmEppImportBatch(batchId, userId)).rejects.toThrow(RESERVED)
    expect(await productsNamed(normalized.name)).toHaveLength(0)
  })

  it("el selector de categorías de un producto común no la ofrece", () => {
    const visible = sparePartsCategory.categoriesForCatalogProducts([
      { id: generalId, slug: "general" },
      { id: SPARE_PARTS_CATEGORY_ID, slug: "repuestos" },
    ])
    expect(visible.map((c) => c.id)).toEqual([generalId])
  })
})

describe("el slug de «Repuestos» no se puede cambiar", () => {
  it("cambiar el slug se rechaza en el servidor", async () => {
    const result = await updateCategory({ ok: false }, categoryForm({
      id: SPARE_PARTS_CATEGORY_ID, name: "Repuestos", slug: "repuestos-viejos", sortOrder: "95",
    }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.slug?.[0]).toMatch(/no se puede cambiar/)
    expect(await category(SPARE_PARTS_CATEGORY_ID)).toMatchObject({ slug: "repuestos" })
  })

  it("renombrarla u ordenarla sin tocar el slug sí se puede", async () => {
    const result = await updateCategory({ ok: false }, categoryForm({
      id: SPARE_PARTS_CATEGORY_ID, name: "Repuestos de flota", slug: "repuestos", sortOrder: "90",
    }))
    expect(result.ok).toBe(true)
    expect(await category(SPARE_PARTS_CATEGORY_ID)).toMatchObject({ name: "Repuestos de flota", slug: "repuestos", sortOrder: 90 })
  })

  it("marcarla como EPP o con aprobación de Prevención se rechaza en el servidor", async () => {
    for (const flag of ["isEpp", "requiresPrevencion"]) {
      const result = await updateCategory({ ok: false }, categoryForm({
        id: SPARE_PARTS_CATEGORY_ID, name: "Repuestos", slug: "repuestos", sortOrder: "95", [flag]: "on",
      }))
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/no se pueden cambiar/)
    }
    expect(await category(SPARE_PARTS_CATEGORY_ID)).toMatchObject({ isEpp: false, requiresPrevencion: false })
  })

  it("otra categoría no puede tomar el slug «repuestos»", async () => {
    const result = await createCategory({ ok: false }, categoryForm({ name: "Repuestos 2", slug: "repuestos", sortOrder: "1" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.slug?.[0]).toBeTruthy()
  })
})
