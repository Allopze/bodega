/**
 * Las prendas EPP llevan logo siempre (docs/superpowers/specs/2026-10-15-epp-con-logo-design.md).
 * La garantía vive en el servidor: todo camino que escribe `product_attributes`
 * pasa sus filas por `applyLogoRule`, porque el asistente puede cambiar el
 * nombre después de armar los atributos y los importadores no pasan por él.
 *
 * Un botín es el caso negativo de cada camino: la regla no debe tocarlo.
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
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
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

const { createProduct, updateProduct, createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
const { normalizeEppRow, confirmEppImportBatch } = await import("@/lib/services/epp-import")
const { importProductsFromXlsx } = await import("@/lib/services/product-xlsx-import")
const { insertSizeVariantFromTemplate } = await import("@/lib/services/epp-size-variant-clone")

const userId = nanoid()
const worksiteId = nanoid()
const categoryId = nanoid()

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

async function attrsOf(productId: string) {
  return inMemoryDb.select().from(schema.productAttributes).where(eq(schema.productAttributes.productId, productId))
}

function formFor(name: string, attributes: unknown[], productId?: string) {
  const fd = new FormData()
  if (productId) fd.set("id", productId)
  fd.set("name", name)
  fd.set("categoryId", categoryId)
  fd.set("unitOfMeasure", "unidad")
  fd.set("isEpp", "on")
  fd.set("isActive", "on")
  fd.set("attributesJson", JSON.stringify(attributes))
  fd.set("suppliersJson", "[]")
  return fd
}

async function productByName(name: string) {
  const [row] = await inMemoryDb.select().from(schema.products).where(eq(schema.products.name, name))
  return row!
}

const logoValues = (rows: Array<{ name: string; options: string | null }>) =>
  rows.filter((a) => a.name === "Logo").map((a) => a.options)

beforeAll(async () => {
  mockAuthFn.mockResolvedValue(session())
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: worksiteId, name: "Faena Test", code: `WS-${nanoid(4).toUpperCase()}`, isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: "Ropa de trabajo", slug: `ropa-${nanoid(4).toLowerCase()}`, isEpp: true,
  })
})

describe("createProduct", () => {
  it("agrega Logo a una polera EPP y no a un botín", async () => {
    const talla = { name: "Talla", type: "select", isRequired: true, options: '["M"]', sortOrder: 0 }
    expect((await createProduct({ ok: false }, formFor("Polera Dryfresh alta", [talla]))).ok).toBe(true)
    expect((await createProduct({ ok: false }, formFor("Botín de seguridad alta", [talla]))).ok).toBe(true)

    const polera = await attrsOf((await productByName("Polera Dryfresh alta")).id)
    expect(logoValues(polera)).toEqual(['["Con logo"]'])
    expect(polera.find((a) => a.name === "Logo")).toMatchObject({ type: "select", isRequired: true, sortOrder: 1 })

    const botin = await attrsOf((await productByName("Botín de seguridad alta")).id)
    expect(botin.map((a) => a.name)).toEqual(["Talla"])
  })
})

describe("updateProduct", () => {
  async function seedPoleraConModelo(name: string) {
    const productId = nanoid()
    await inMemoryDb.insert(schema.products).values({
      id: productId, sku: `EPP-${nanoid(6).toUpperCase()}`, name, categoryId,
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
    })
    const tallaId = nanoid()
    const modeloId = nanoid()
    await inMemoryDb.insert(schema.productAttributes).values([
      { id: tallaId, productId, name: "Talla", type: "select", isRequired: true, options: '["M"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: modeloId, productId, name: "Modelo", type: "select", isRequired: true, options: '["Con logo"]', sortOrder: 1 },
    ])
    // Una solicitud ya apunta al atributo: borrarlo reventaría con 23503.
    const requestId = nanoid()
    const itemId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid(6).toUpperCase()}`, worksiteId, requesterId: userId, status: "submitted",
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productId, quantity: 1, unitOfMeasure: "unidad",
    })
    await inMemoryDb.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: itemId, attributeId: modeloId, attributeName: "Modelo", value: "Con logo",
    })
    return { productId, tallaId, modeloId }
  }

  it("renombra en el lugar el Modelo «Con logo» (mismo id, sin error de FK) y no duplica en una segunda edición", async () => {
    const { productId, tallaId, modeloId } = await seedPoleraConModelo("Polera Piqué edición")
    const formAttrs = () => [
      { id: tallaId, name: "Talla", type: "select", isRequired: true, options: '["M"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: modeloId, name: "Modelo", type: "select", isRequired: true, options: '["Con logo"]', sortOrder: 1 },
    ]

    const first = await updateProduct({ ok: false }, formFor("Polera Piqué edición", formAttrs(), productId))
    expect(first.ok).toBe(true)
    const afterFirst = await attrsOf(productId)
    expect(afterFirst).toHaveLength(2)
    expect(afterFirst.find((a) => a.id === modeloId)).toMatchObject({ name: "Logo", type: "select", options: '["Con logo"]' })

    // El cliente que ya ve el Logo reenvía la fila con el mismo id.
    const second = await updateProduct({ ok: false }, formFor("Polera Piqué edición", [
      { id: tallaId, name: "Talla", type: "select", isRequired: true, options: '["M"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: modeloId, name: "Logo", type: "select", isRequired: true, options: '["Con logo"]', sortOrder: 1 },
    ], productId))
    expect(second.ok).toBe(true)
    const afterSecond = await attrsOf(productId)
    expect(afterSecond).toHaveLength(2)
    expect(logoValues(afterSecond)).toHaveLength(1)

    // La solicitud sigue apuntando a la misma fila.
    const links = await inMemoryDb.select().from(schema.requestItemAttributes)
    expect(links.some((l) => l.attributeId === modeloId)).toBe(true)
  })

  it("acepta que el cliente ya mande el Modelo renombrado a Logo aunque la prenda tenga historial", async () => {
    const { productId, tallaId, modeloId } = await seedPoleraConModelo("Polera Dry Fit renombrada")
    const result = await updateProduct({ ok: false }, formFor("Polera Dry Fit renombrada", [
      { id: tallaId, name: "Talla", type: "select", isRequired: true, options: '["M"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: modeloId, name: "Logo", type: "select", isRequired: true, options: '["Con logo"]', sortOrder: 1 },
    ], productId))
    expect(result.ok).toBe(true)
    expect((await attrsOf(productId)).find((a) => a.id === modeloId)?.name).toBe("Logo")
  })

  it("inserta un Logo nuevo si la prenda no tenía ninguno, y no toca un botín", async () => {
    const talla = (id?: string) => ({ id, name: "Talla", type: "select", isRequired: true, options: '["M"]', sortOrder: 0 })
    await createProduct({ ok: false }, formFor("Botín edición", [talla()]))
    const botin = await productByName("Botín edición")
    const botinAttrs = await attrsOf(botin.id)
    expect((await updateProduct({ ok: false }, formFor("Botín edición", [talla(botinAttrs[0]!.id)], botin.id))).ok).toBe(true)
    expect((await attrsOf(botin.id)).map((a) => a.name)).toEqual(["Talla"])

    // Una prenda que nació sin logo (antes de la regla) lo recibe al editarse.
    const productId = nanoid()
    await inMemoryDb.insert(schema.products).values({
      id: productId, sku: `EPP-${nanoid(6).toUpperCase()}`, name: "Chaleco geólogo edición", categoryId,
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
    })
    const tallaId = nanoid()
    await inMemoryDb.insert(schema.productAttributes).values({ id: tallaId, productId, name: "Talla", type: "select", isRequired: true, options: '["L"]', sortOrder: 0 })
    expect((await updateProduct({ ok: false }, formFor("Chaleco geólogo edición", [talla(tallaId)], productId))).ok).toBe(true)
    expect(logoValues(await attrsOf(productId))).toEqual(['["Con logo"]'])
  })
})

describe("createProductVariantBatch", () => {
  it("agrega Logo a cada variante de una polera y no a las de un botín", async () => {
    const base = {
      categoryId, unitOfMeasure: "unidad" as const, isEpp: true, isActive: true,
      attributes: [{ name: "Talla", type: "select" as const, options: JSON.stringify(["M", "L"]), sizeFamily: "ropa", sortOrder: 0 }],
    }
    const polera = await createProductVariantBatch({
      ...base, familyName: "Polera lote",
      variants: [
        { name: "Polera lote M", attributes: [{ name: "Talla", value: "M" }] },
        { name: "Polera lote L", attributes: [{ name: "Talla", value: "L" }] },
      ],
    })
    expect(polera.ok).toBe(true)
    for (const name of ["Polera lote M", "Polera lote L"]) {
      const rows = await attrsOf((await productByName(name)).id)
      expect(logoValues(rows)).toEqual(['["Con logo"]'])
      expect(rows.find((a) => a.name === "Talla")?.sizeFamily).toBe("ropa")
    }

    const botin = await createProductVariantBatch({
      ...base, familyName: "Botín lote",
      variants: [{ name: "Botín lote M", attributes: [{ name: "Talla", value: "M" }] }],
    })
    expect(botin.ok).toBe(true)
    expect((await attrsOf((await productByName("Botín lote M")).id)).map((a) => a.name)).toEqual(["Talla"])
  })
})

describe("confirmEppImportBatch", () => {
  it("una polera importada queda con Logo y un botín no", async () => {
    const rows = [
      normalizeEppRow({ name: "Polera Dryfresh importada", unitOfMeasure: "unidad", attributes: "Talla: M" }),
      normalizeEppRow({ name: "Botín dieléctrico importado", unitOfMeasure: "par", attributes: "Talla: 42" }),
    ]
    const batchId = nanoid()
    await inMemoryDb.insert(schema.eppImportBatches).values({
      id: batchId, fileName: "t.xlsx", fileHash: nanoid(), status: "review", sourceFileData: "", createdBy: userId,
    })
    for (const [i, normalized] of rows.entries()) {
      await inMemoryDb.insert(schema.eppImportRows).values({
        id: nanoid(), batchId, rowNumber: i + 1, originalJson: "{}", normalizedJson: JSON.stringify(normalized), decision: "create",
      })
    }
    await confirmEppImportBatch(batchId, userId)

    const polera = await attrsOf((await productByName(rows[0]!.name)).id)
    expect(logoValues(polera)).toEqual(['["Con logo"]'])
    const botin = await attrsOf((await productByName(rows[1]!.name)).id)
    expect(botin.some((a) => a.name === "Logo")).toBe(false)
  })
})

describe("importProductsFromXlsx", () => {
  it("una polera importada queda con Logo y un botín no", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("EPP")
    sheet.addRow(["SKU", "Nombre", "Atributos"])
    sheet.addRow(["POL-XLSX-1", "Polera Dryfresh xlsx", "Talla: M"])
    sheet.addRow(["BOT-XLSX-1", "Botín xlsx", "Talla: 42"])
    const result = await importProductsFromXlsx(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(result.errors).toEqual([])

    expect(logoValues(await attrsOf((await productByName("Polera Dryfresh xlsx")).id))).toEqual(['["Con logo"]'])
    expect((await attrsOf((await productByName("Botín xlsx")).id)).map((a) => a.name)).toEqual(["Talla"])
  })
})

describe("insertSizeVariantFromTemplate", () => {
  async function templateFor(name: string, extra: Array<{ name: string; options: string }>) {
    const productId = nanoid()
    await inMemoryDb.insert(schema.products).values({
      id: productId, sku: `EPP-T-${nanoid(5).toUpperCase()}`, name, categoryId,
      unitOfMeasure: "unidad", isEpp: true, isActive: true,
    })
    const sizeAttrId = nanoid()
    await inMemoryDb.insert(schema.productAttributes).values([
      { id: sizeAttrId, productId, name: "Talla", type: "select", isRequired: true, options: '["M"]', sizeFamily: "ropa", sortOrder: 0 },
      ...extra.map((e, i) => ({ id: nanoid(), productId, name: e.name, type: "select", isRequired: true, options: e.options, sortOrder: i + 1 })),
    ])
    const template = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.id, productId), with: { productAttributes: true, productSuppliers: true },
    })
    return { template: template!, sizeAttr: template!.productAttributes.find((a) => a.id === sizeAttrId)! }
  }

  it("la talla clonada de una polera conserva un único Logo, también cuando la plantilla traía Modelo «Con logo»", async () => {
    for (const extra of [[], [{ name: "Modelo", options: '["Con logo"]' }], [{ name: "Logo", options: '["Con logo"]' }]]) {
      const { template, sizeAttr } = await templateFor(`Polera clon ${extra[0]?.name ?? "sin"}`, extra)
      const id = await insertSizeVariantFromTemplate(inMemoryDb as never, { template, templateSizeAttr: sizeAttr, size: "XL", sizeFamily: "ropa" })
      const rows = await attrsOf(id)
      expect(logoValues(rows)).toEqual(['["Con logo"]'])
      expect(rows.some((a) => a.name === "Modelo")).toBe(false)
      expect(rows.find((a) => a.name === "Talla")?.options).toBe('["XL"]')
    }
  })

  it("no agrega Logo a la talla clonada de un botín", async () => {
    const { template, sizeAttr } = await templateFor("Botín clon", [])
    const id = await insertSizeVariantFromTemplate(inMemoryDb as never, { template, templateSizeAttr: sizeAttr, size: "43", sizeFamily: "calzado" })
    expect((await attrsOf(id)).map((a) => a.name)).toEqual(["Talla"])
  })
})
