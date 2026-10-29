import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import * as schema from "@/db/schema"

// El script importa `@/db` estáticamente: se importa dinámicamente dentro de
// cada test, una vez asignado `testGlobal.__db` (mismo cuidado que
// apply-pdtp-2026-objectives.test.ts).

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const CATEGORY_ID = "cat-epp"

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
  await inMemoryDb.delete(schema.productCategories)
  await inMemoryDb.insert(schema.productCategories).values({ id: CATEGORY_ID, name: "EPP", slug: "epp", isEpp: true })
  await inMemoryDb.insert(schema.eppProductFamilies).values([
    { id: "fam-evalight", categoryId: CATEGORY_ID, canonicalName: "Botin VFlex V81 Evalight", identityKey: "k-evalight" },
    { id: "fam-polera", categoryId: CATEGORY_ID, canonicalName: "Polera Dryfresh Smooth M/Larga", identityKey: "k-polera" },
  ])
})

async function product(input: { sku: string; name: string; familyId?: string; isActive?: boolean; attributes: Record<string, string> }) {
  const id = `p-${input.sku}`
  await inMemoryDb.insert(schema.products).values({
    id, sku: input.sku, name: input.name, categoryId: CATEGORY_ID, familyId: input.familyId ?? null,
    isEpp: true, isActive: input.isActive ?? true,
  })
  for (const [index, [name, value]] of Object.entries(input.attributes).entries()) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId: id, name, type: "select", isRequired: true, options: JSON.stringify([value]), sortOrder: index,
    })
  }
}

/** Estado de producción del 2026-10-29 para un SKU de cada acción del plan. */
async function seedProductionState() {
  await product({ sku: "EPP-157", name: "Botín V-Flex Thinsulate V15", attributes: { Talla: "38", Color: "Negro/Azul" } })
  await product({ sku: "EPP-096", name: "Pantalón Lightwind H3200 nylon spandex hombre", attributes: { Talla: "L", Color: "Beige", Modelo: "H3200", Logo: "Con logo" } })
  await product({ sku: "EPP-332", name: "Botin VFlex V81 Evalight", familyId: "fam-evalight", attributes: { "Talla calzado": "36", Color: "Gris", Genero: "Mujer" } })
  await product({ sku: "EPP-313", name: "Botin VFlex V81 Evalight 38 Negro", familyId: "fam-evalight", attributes: { "Talla calzado": "38", Color: "Negro" } })
  await product({ sku: "EPP-276", name: "Polera Dryfresh Smooth M/Larga", familyId: "fam-polera", isActive: false, attributes: { Color: "Piedra", Logo: "Con logo", Talla: "S" } })
}

async function attributesOf(sku: string) {
  const row = await inMemoryDb.query.products.findFirst({
    where: eq(schema.products.sku, sku),
    with: { productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] } },
  })
  return Object.fromEntries(row!.productAttributes.map((a) => [a.name, JSON.parse(a.options!)[0]]))
}

async function productBySku(sku: string) {
  return (await inMemoryDb.query.products.findFirst({ where: eq(schema.products.sku, sku) }))!
}

describe("decisiones de catálogo EPP 2026-10-29", () => {
  it("sin --apply informa y no escribe nada", async () => {
    await seedProductionState()
    const { applyCatalogDecisions20261029 } = await import("../apply-epp-catalog-decisions-2026-10-29")

    const outcomes = await applyCatalogDecisions20261029()

    expect(outcomes.filter((o) => o.result === "dry-run").map((o) => o.sku).sort())
      .toEqual(["EPP-096", "EPP-157", "EPP-276", "EPP-313", "EPP-313", "EPP-332", "EPP-332"])
    expect(await attributesOf("EPP-157")).toEqual({ Talla: "38", Color: "Negro/Azul" })
    expect((await productBySku("EPP-276")).isActive).toBe(false)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })

  it("completa los atributos, unifica el nombre del Evalight y reactiva el color Piedra", async () => {
    await seedProductionState()
    const { applyCatalogDecisions20261029 } = await import("../apply-epp-catalog-decisions-2026-10-29")

    await applyCatalogDecisions20261029({ apply: true })

    expect(await attributesOf("EPP-157")).toEqual({ Talla: "38", Color: "Negro/Azul", Modelo: "V15" })
    expect(await attributesOf("EPP-096")).toMatchObject({ Género: "Hombre" })
    expect(await attributesOf("EPP-332")).toEqual({ "Talla calzado": "36", Color: "Gris", Género: "Mujer" })
    expect(await attributesOf("EPP-313")).toEqual({ "Talla calzado": "38", Color: "Negro", Género: "Mujer" })
    expect((await productBySku("EPP-313")).name).toBe("Botín VFlex V81 Evalight")
    expect((await productBySku("EPP-332")).name).toBe("Botín VFlex V81 Evalight")
    expect((await productBySku("EPP-276")).isActive).toBe(true)
    const audits = await inMemoryDb.select().from(schema.auditLog)
    expect(audits).toHaveLength(7)
    expect(audits.every((entry) => entry.reason?.startsWith("Decisiones de catálogo EPP (2026-10-29)"))).toBe(true)
  })

  it("una segunda corrida no cambia nada", async () => {
    await seedProductionState()
    const { applyCatalogDecisions20261029 } = await import("../apply-epp-catalog-decisions-2026-10-29")

    await applyCatalogDecisions20261029({ apply: true })
    const second = await applyCatalogDecisions20261029({ apply: true })

    expect(second.filter((o) => o.result === "aplicado")).toEqual([])
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(7)
  })

  it("no toca un SKU que no es el producto esperado", async () => {
    await product({ sku: "EPP-157", name: "Otro producto", attributes: { Talla: "38" } })
    await product({ sku: "EPP-276", name: "Polera Dryfresh Smooth M/Larga", familyId: "fam-polera", isActive: false, attributes: { Color: "Azul Marino", Talla: "S" } })
    const { applyCatalogDecisions20261029 } = await import("../apply-epp-catalog-decisions-2026-10-29")

    const outcomes = await applyCatalogDecisions20261029({ apply: true })

    expect(outcomes.find((o) => o.sku === "EPP-157")).toMatchObject({ result: "omitido", detail: expect.stringContaining("Otro producto") })
    expect(outcomes.find((o) => o.sku === "EPP-276")).toMatchObject({ result: "omitido", detail: "Color es Azul Marino" })
    expect(await attributesOf("EPP-157")).toEqual({ Talla: "38" })
    expect((await productBySku("EPP-276")).isActive).toBe(false)
  })

  it("no pisa un atributo que ya tiene otro valor", async () => {
    await product({ sku: "EPP-096", name: "Pantalón Lightwind H3200 nylon spandex hombre", attributes: { Talla: "L", Género: "Unisex" } })
    const { applyCatalogDecisions20261029 } = await import("../apply-epp-catalog-decisions-2026-10-29")

    const outcomes = await applyCatalogDecisions20261029({ apply: true })

    expect(outcomes.find((o) => o.sku === "EPP-096")).toMatchObject({ result: "omitido" })
    expect(await attributesOf("EPP-096")).toEqual({ Talla: "L", Género: "Unisex" })
  })
})
