/**
 * `addMissingPantsSizeVariants` completa S/M/L/XL/2XL en familias de pantalón
 * que ya usan "Talla" (escala de ropa), sin tocar familias sin precedente de
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

const { addMissingPantsSizeVariants, PANTS_TARGET_SIZES } = await import("@/lib/services/epp-pants-sizes")

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
  size: string | null
  extraAttrs?: Array<{ name: string; value: string }>
  eppType?: string | null
}) {
  await inMemoryDb.insert(schema.eppProductFamilies).values({
    id: input.familyId,
    categoryId: CATEGORY_ID,
    canonicalName: input.canonicalName,
    identityKey: `key-${input.familyId}`,
    eppType: input.eppType === undefined ? "pantalon" : input.eppType,
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
  if (input.size) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId, name: "Talla", type: "select",
      isRequired: true, options: JSON.stringify([input.size]), sortOrder: sortOrder++,
    })
  }
  await inMemoryDb.insert(schema.productSuppliers).values({
    id: nanoid(), productId, supplierId: SUPPLIER_ID, unitPrice: 26400, isPreferred: true,
  })

  return productId
}

async function sizesForFamily(familyId: string): Promise<string[]> {
  const variants = await inMemoryDb.query.products.findMany({
    where: eq(schema.products.familyId, familyId),
    with: { productAttributes: true },
  })
  return variants
    .flatMap((v) => v.productAttributes)
    .filter((a) => a.name === "Talla")
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

describe("addMissingPantsSizeVariants", () => {
  it("creates the missing sizes for a pants family that already uses Talla", async () => {
    await createFamilyWithVariant({
      familyId: "fam-lightwind-hombre",
      canonicalName: "Pantalón Lightwind nylon spandex hombre UV",
      productName: "Pantalón Lightwind nylon spandex hombre UV",
      size: "2XL",
      extraAttrs: [{ name: "Modelo", value: "H3200" }, { name: "Color", value: "Beige" }],
    })

    const summary = await addMissingPantsSizeVariants()

    expect(summary.results).toEqual([
      expect.objectContaining({ familyId: "fam-lightwind-hombre", status: "created", createdSizes: ["S", "M", "L", "XL"] }),
    ])
    expect(summary.variantsCreated).toBe(4)

    const sizes = await sizesForFamily("fam-lightwind-hombre")
    expect(sizes).toEqual([...PANTS_TARGET_SIZES].sort())

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

  it("treats XXL as the same size as 2XL and does not duplicate it", async () => {
    await createFamilyWithVariant({
      familyId: "fam-xxl",
      canonicalName: "Pantalón cargo",
      productName: "Pantalón cargo",
      size: "XXL",
    })

    await addMissingPantsSizeVariants()

    const sizes = await sizesForFamily("fam-xxl")
    expect(sizes.filter((s) => s === "2XL" || s === "XXL")).toHaveLength(1)
  })

  it("is idempotent: running it twice does not create duplicate variants", async () => {
    await createFamilyWithVariant({
      familyId: "fam-idem",
      canonicalName: "Pantalón slack",
      productName: "Pantalón slack",
      size: "M",
    })

    const first = await addMissingPantsSizeVariants()
    const second = await addMissingPantsSizeVariants()

    expect(first.variantsCreated).toBe(4)
    expect(second.variantsCreated).toBe(0)
    expect(second.results[0]).toMatchObject({ status: "already_complete" })

    const sizes = await sizesForFamily("fam-idem")
    expect(sizes).toEqual([...PANTS_TARGET_SIZES].sort())
  })

  it("skips a pants family with no Talla attribute at all", async () => {
    await createFamilyWithVariant({
      familyId: "fam-sin-talla",
      canonicalName: "Pantalón slack cargo gabardina con logo",
      productName: "Pantalón slack cargo gabardina con logo",
      size: null,
      extraAttrs: [{ name: "Color", value: "Gris/Naranjo" }],
    })

    const summary = await addMissingPantsSizeVariants()

    expect(summary.results).toEqual([
      expect.objectContaining({ familyId: "fam-sin-talla", status: "skipped_no_talla_attribute", createdSizes: [] }),
    ])
    const sizes = await sizesForFamily("fam-sin-talla")
    expect(sizes).toEqual([])
  })

  it("skips a pants family sized only by 'Talla inferior' (waist scale)", async () => {
    await createFamilyWithVariant({
      familyId: "fam-cintura",
      canonicalName: "Pantalón industrial",
      productName: "Pantalón industrial",
      size: null,
    })
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId: "fam-cintura-p0", name: "Talla inferior", type: "select",
      isRequired: true, options: JSON.stringify(["34"]), sortOrder: 0,
    })

    const summary = await addMissingPantsSizeVariants()

    expect(summary.results).toEqual([
      expect.objectContaining({ familyId: "fam-cintura", status: "skipped_no_talla_attribute" }),
    ])
  })

  it("ignores families whose eppType is not 'pantalon'", async () => {
    await createFamilyWithVariant({
      familyId: "fam-casco",
      canonicalName: "Casco de seguridad",
      productName: "Casco de seguridad",
      size: "M",
      eppType: "casco",
    })

    const summary = await addMissingPantsSizeVariants()

    expect(summary.familiesScanned).toBe(0)
    expect(summary.results).toEqual([])
  })
})
