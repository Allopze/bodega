/**
 * `addMissingClothingSizeVariants` completa XS/S/M/L/XL/2XL en toda familia
 * EPP que ya usa "Talla" (escala de ropa) — sin importar su `eppType`, que
 * está deprecado y casi siempre nulo — sin tocar familias sin precedente de
 * esa escala ni duplicar tallas ya creadas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { addMissingClothingSizeVariants, CLOTHING_TARGET_SIZES } = await import("@/lib/services/epp-clothing-sizes")

const CATEGORY_ID = "cat-epp-ropa"
const SUPPLIER_ID = "sup-treck"

async function seedBaseCatalog() {
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID, name: "Ropa de trabajo", slug: "ropa-de-trabajo", isEpp: true, requiresPrevencion: true,
  })
  await inMemoryDb.insert(schema.suppliers).values({ id: SUPPLIER_ID, name: "Treck" })
}

async function createFamilyWithVariant(input: {
  familyId: string
  canonicalName: string
  productName: string
  sizeAttrName: string | null
  size: string | null
  /** `product_attributes.size_family` del atributo de talla. */
  sizeFamily?: string | null
  extraAttrs?: Array<{ name: string; value: string }>
  eppType?: string | null
}) {
  await inMemoryDb.insert(schema.eppProductFamilies).values({
    id: input.familyId,
    categoryId: CATEGORY_ID,
    canonicalName: input.canonicalName,
    identityKey: `key-${input.familyId}`,
    eppType: input.eppType ?? null,
  })

  const productId = `${input.familyId}-p0`
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `EPP-SEED-${input.familyId}`, name: input.productName,
    categoryId: CATEGORY_ID, familyId: input.familyId, isEpp: true, requiresPrevencion: true,
  })

  let sortOrder = 0
  for (const attr of input.extraAttrs ?? []) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId, name: attr.name, type: "select",
      isRequired: true, options: JSON.stringify([attr.value]), sortOrder: sortOrder++,
    })
  }
  if (input.sizeAttrName && input.size) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId, name: input.sizeAttrName, type: "select",
      isRequired: true, options: JSON.stringify([input.size]),
      sizeFamily: input.sizeFamily ?? null, sortOrder: sortOrder++,
    })
  }
  await inMemoryDb.insert(schema.productSuppliers).values({
    id: nanoid(), productId, supplierId: SUPPLIER_ID, unitPrice: 26400, isPreferred: true,
  })

  return productId
}

async function sizesForFamily(familyId: string, attrName = "Talla"): Promise<string[]> {
  const variants = await inMemoryDb.query.products.findMany({
    where: eq(schema.products.familyId, familyId),
    with: { productAttributes: true },
  })
  return variants
    .flatMap((v) => v.productAttributes)
    .filter((a) => a.name === attrName)
    .map((a) => JSON.parse(a.options!)[0] as string)
    .sort()
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.productSuppliers)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
  await inMemoryDb.delete(schema.suppliers)
  await inMemoryDb.delete(schema.productCategories)
  await seedBaseCatalog()
})

describe("addMissingClothingSizeVariants", () => {
  it("creates the missing sizes for a pants family that already uses Talla", async () => {
    await createFamilyWithVariant({
      familyId: "fam-lightwind-hombre",
      canonicalName: "Pantalón Lightwind nylon spandex hombre UV",
      productName: "Pantalón Lightwind nylon spandex hombre UV",
      sizeAttrName: "Talla",
      size: "2XL",
      sizeFamily: "ropa",
      extraAttrs: [{ name: "Modelo", value: "H3200" }, { name: "Color", value: "Beige" }],
      eppType: "pantalon",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results).toEqual([
      expect.objectContaining({ familyId: "fam-lightwind-hombre", status: "created", createdSizes: ["XS", "S", "M", "L", "XL"] }),
    ])
    expect(summary.variantsCreated).toBe(5)

    const sizes = await sizesForFamily("fam-lightwind-hombre")
    expect(sizes).toEqual([...CLOTHING_TARGET_SIZES].sort())

    // El resto de los atributos (marca/modelo/color) se clonaron a cada talla nueva.
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-lightwind-hombre"),
      with: { productAttributes: true, productSuppliers: true },
    })
    for (const variant of variants) {
      const model = variant.productAttributes.find((a) => a.name === "Modelo")
      expect(model?.options).toBe(JSON.stringify(["H3200"]))
      expect(variant.productSuppliers).toHaveLength(1)
      expect(variant.productSuppliers[0]?.supplierId).toBe(SUPPLIER_ID)
    }

    // Los SKUs nuevos son únicos y no chocan con el original.
    const skus = new Set(variants.map((v) => v.sku))
    expect(skus.size).toBe(variants.length)
  })

  it("also completes a non-pants EPP family (jacket) sized by the same 'Talla' scale", async () => {
    await createFamilyWithVariant({
      familyId: "fam-chaqueta",
      canonicalName: "Chaqueta cortavientos",
      productName: "Chaqueta cortavientos",
      sizeAttrName: "Talla",
      size: "M",
      sizeFamily: "ropa",
      eppType: null, // eppType casi siempre queda nulo fuera del import XLSX
    })

    const summary = await addMissingClothingSizeVariants()

    const jacket = summary.results.find((r) => r.familyId === "fam-chaqueta")
    expect(jacket).toMatchObject({ status: "created", createdSizes: ["XS", "S", "L", "XL", "2XL"] })

    const sizes = await sizesForFamily("fam-chaqueta")
    expect(sizes).toEqual([...CLOTHING_TARGET_SIZES].sort())
  })

  it("treats XXL as the same size as 2XL and does not duplicate it", async () => {
    await createFamilyWithVariant({
      familyId: "fam-xxl",
      canonicalName: "Pantalón cargo",
      productName: "Pantalón cargo",
      sizeAttrName: "Talla",
      size: "XXL",
      sizeFamily: "ropa",
    })

    await addMissingClothingSizeVariants()

    const sizes = await sizesForFamily("fam-xxl")
    expect(sizes.filter((s) => s === "2XL" || s === "XXL")).toHaveLength(1)
  })

  it("is idempotent: running it twice does not create duplicate variants", async () => {
    await createFamilyWithVariant({
      familyId: "fam-idem",
      canonicalName: "Pantalón slack",
      productName: "Pantalón slack",
      sizeAttrName: "Talla",
      size: "M",
      sizeFamily: "ropa",
    })

    const first = await addMissingClothingSizeVariants()
    const second = await addMissingClothingSizeVariants()

    expect(first.variantsCreated).toBe(5)
    expect(second.variantsCreated).toBe(0)
    expect(second.results.find((r) => r.familyId === "fam-idem")).toMatchObject({ status: "already_complete" })

    const sizes = await sizesForFamily("fam-idem")
    expect(sizes).toEqual([...CLOTHING_TARGET_SIZES].sort())
  })

  it("leaves a family with no Talla attribute at all out of the results", async () => {
    await createFamilyWithVariant({
      familyId: "fam-sin-talla",
      canonicalName: "Pantalón slack cargo gabardina con logo",
      productName: "Pantalón slack cargo gabardina con logo",
      sizeAttrName: null,
      size: null,
      extraAttrs: [{ name: "Color", value: "Gris/Naranjo" }],
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.find((r) => r.familyId === "fam-sin-talla")).toBeUndefined()
    const sizes = await sizesForFamily("fam-sin-talla")
    expect(sizes).toEqual([])
  })

  it("leaves a family sized only by 'Talla inferior' (waist scale) out of the results", async () => {
    await createFamilyWithVariant({
      familyId: "fam-cintura",
      canonicalName: "Pantalón industrial",
      productName: "Pantalón industrial",
      sizeAttrName: "Talla inferior",
      size: "34",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.find((r) => r.familyId === "fam-cintura")).toBeUndefined()
    const sizes = await sizesForFamily("fam-cintura", "Talla inferior")
    expect(sizes).toEqual(["34"])
  })

  it("leaves a family sized only by 'Talla calzado' (shoe scale) out of the results", async () => {
    await createFamilyWithVariant({
      familyId: "fam-zapato",
      canonicalName: "Zapato de seguridad",
      productName: "Zapato de seguridad",
      sizeAttrName: "Talla calzado",
      size: "42",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.find((r) => r.familyId === "fam-zapato")).toBeUndefined()
  })

  it("no le inyecta la escala de ropa a un pantalón sizado por número de cintura bajo el atributo genérico 'Talla'", async () => {
    // El atributo se llama "Talla" igual que en la escala de ropa —el nombre
    // solo no distingue un pantalón por cintura de un buzo por XS..2XL—, pero
    // "42" no es una letra de esa escala: sin el guard numérico, el backfill
    // le habría creado las seis tallas XS..2XL a un pantalón que se vende por
    // número.
    await createFamilyWithVariant({
      familyId: "fam-pantalon-cintura-generico",
      canonicalName: "Pantalón Gabardina",
      productName: "Pantalón Gabardina",
      sizeAttrName: "Talla",
      size: "42",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.find((r) => r.familyId === "fam-pantalon-cintura-generico")).toBeUndefined()
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-pantalon-cintura-generico"),
    })
    expect(variants).toHaveLength(1)
  })

  it("sí completa una familia de ropa cuya única talla existente es '3XL' (fuera de CLOTHING_TARGET_SIZES)", async () => {
    // El criterio es "alguna etiqueta no es numérica", no "alguna está en
    // CLOTHING_TARGET_SIZES": una familia de ropa que hoy sólo tenga una talla
    // fuera de esa lista no debe quedar excluida por el guard numérico.
    await createFamilyWithVariant({
      familyId: "fam-3xl",
      canonicalName: "Buzo Térmico",
      productName: "Buzo Térmico",
      sizeAttrName: "Talla",
      size: "3XL",
      sizeFamily: "ropa",
    })

    const summary = await addMissingClothingSizeVariants()

    const buzo = summary.results.find((r) => r.familyId === "fam-3xl")
    expect(buzo).toMatchObject({ status: "created" })
    expect(buzo?.createdSizes).toEqual(expect.arrayContaining(["XS", "S", "M", "L", "XL", "2XL"]))

    const sizes = await sizesForFamily("fam-3xl")
    expect(sizes).toEqual([...CLOTHING_TARGET_SIZES, "3XL"].sort())
  })

  it("no toca una familia cuyo atributo de talla no declara `size_family`", async () => {
    // El criterio «el atributo se llama Talla» alcanzaba a todo el catálogo
    // importado, donde `size_family` es NULL en las 230 filas: botines `N41`,
    // guantes `N-9` y una capa `Única` entraban por igual y recibían seis
    // variantes XS..2XL inventadas. Ahora la familia tiene que declararse.
    await createFamilyWithVariant({
      familyId: "fam-sin-familia",
      canonicalName: "Botín V-Flex V73 Microfiber",
      productName: "Botín V-Flex V73 Microfiber",
      sizeAttrName: "Talla",
      size: "N41",
      sizeFamily: null,
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.some((result) => result.familyId === "fam-sin-familia")).toBe(false)
    expect(summary.variantsCreated).toBe(0)
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-sin-familia"),
    })
    expect(variants).toHaveLength(1)
  })

  it("no toca una familia declarada de otra familia de tallas", async () => {
    await createFamilyWithVariant({
      familyId: "fam-calzado-declarado",
      canonicalName: "Botín Proflex",
      productName: "Botín Proflex",
      sizeAttrName: "Talla",
      size: "41",
      sizeFamily: "calzado",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.some((result) => result.familyId === "fam-calzado-declarado")).toBe(false)
    expect(summary.variantsCreated).toBe(0)
  })

  it("en dry-run informa lo que crearía y no escribe nada", async () => {
    await createFamilyWithVariant({
      familyId: "fam-dry",
      canonicalName: "Chaqueta Activex micropolar",
      productName: "Chaqueta Activex micropolar",
      sizeAttrName: "Talla",
      size: "M",
      sizeFamily: "ropa",
    })

    const summary = await addMissingClothingSizeVariants({ dryRun: true })

    expect(summary.dryRun).toBe(true)
    expect(summary.variantsCreated).toBe(5)
    expect(summary.results[0]!.createdSizes).toEqual(["XS", "S", "L", "XL", "2XL"])
    // Lo informado no se escribió: la familia sigue con su única variante.
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-dry"),
    })
    expect(variants).toHaveLength(1)
  })

  it("no le inyecta la escala de ropa a una familia de guantes", async () => {
    // El importador dejaba los guantes con `Talla: T/L`, que normaliza a
    // "talla", así que este backfill los tomaba por ropa y les creaba
    // XS..2XL. Con `Talla guantes` la familia queda fuera.
    await createFamilyWithVariant({
      familyId: "fam-guante",
      canonicalName: "Guante Nitrilo Showa",
      productName: "Guante Nitrilo Showa",
      sizeAttrName: "Talla guantes",
      size: "L",
    })

    const summary = await addMissingClothingSizeVariants()

    expect(summary.results.find((r) => r.familyId === "fam-guante")).toBeUndefined()
    const variants = await inMemoryDb.query.products.findMany({
      where: eq(schema.products.familyId, "fam-guante"),
    })
    expect(variants).toHaveLength(1)
  })
})
