/**
 * `completeSizeRanges` completa 38..46 en calzado y S..3XL en ropa/pantalón,
 * para que el selector de talla de Solicitudes las ofrezca, y da de baja las
 * variantes sin talla —sin stock ni historial— que lo hacían caer a «Variante».
 *
 * Los casos negativos importan tanto como los positivos: el backfill de ropa,
 * con un criterio laxo, inyectó 158 variantes inventadas a botines y guantes.
 * Acá un guante `N-9`, un botín con talla de letra, un chaleco `Única` y una
 * talla dada de baja a mano no se tocan.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import { resolveProductSize } from "@/lib/products/product-size"
import { groupProductVariants } from "@/lib/products/variant-grouping"
import type { ProductOption } from "@/app/(app)/solicitudes/request-form.types"

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

const { completeSizeRanges, labelInGroupStyle, targetSizesFor } = await import("@/lib/services/epp-size-ranges")
const FOOTWEAR_TARGET_SIZES = targetSizesFor("calzado")
const { getSizeVariantPicker } = await import("@/app/(app)/solicitudes/variant-selector.helpers")

const CATEGORY_ID = "cat-epp-calzado"
const SUPPLIER_ID = "sup-vflex"

let skuSeq = 0

async function createVariant(input: {
  name: string
  size: string | null
  sizeAttrName?: string
  sizeFamily?: string | null
  familyId?: string | null
  isActive?: boolean
  extraAttrs?: Array<{ name: string; value: string }>
}) {
  const productId = nanoid()
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `EPP-${String(++skuSeq).padStart(3, "0")}`, name: input.name,
    categoryId: CATEGORY_ID, familyId: input.familyId ?? null, isEpp: true, requiresPrevencion: true,
    unitOfMeasure: "par", isActive: input.isActive ?? true,
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
      id: nanoid(), productId, name: input.sizeAttrName ?? "Talla", type: "select",
      isRequired: true, options: JSON.stringify([input.size]),
      sizeFamily: input.sizeFamily ?? null, sortOrder: sortOrder++,
    })
  }
  await inMemoryDb.insert(schema.productSuppliers).values({
    id: nanoid(), productId, supplierId: SUPPLIER_ID, unitPrice: 32990, isPreferred: true,
  })
  return productId
}

async function variantsNamed(name: string) {
  const rows = await inMemoryDb.query.products.findMany({
    where: (p, { eq }) => eq(p.name, name),
    with: { productAttributes: true, productSuppliers: true },
  })
  return rows
}

async function sizesNamed(name: string, opts: { activeOnly?: boolean } = {}) {
  const rows = await variantsNamed(name)
  return rows
    .filter((row) => !opts.activeOnly || row.isActive)
    .map((row) => resolveProductSize(row.productAttributes)?.label ?? null)
}

beforeEach(async () => {
  skuSeq = 0
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.productSuppliers)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
  await inMemoryDb.delete(schema.suppliers)
  await inMemoryDb.delete(schema.productCategories)
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID, name: "Calzado de seguridad", slug: "calzado", isEpp: true, requiresPrevencion: true,
  })
  await inMemoryDb.insert(schema.suppliers).values({ id: SUPPLIER_ID, name: "V-Flex" })
})

describe("completeSizeRanges · calzado", () => {
  it("completa 38..46 en un botín sin familia, en el estilo de etiqueta del grupo, y Solicitudes las ofrece", async () => {
    const name = "Botín V-Flex V73 Microfiber"
    for (const size of ["N41", "N42", "N43", "N44"]) {
      await createVariant({ name, size, extraAttrs: [{ name: "Modelo", value: "Microfiber" }, { name: "Color", value: "Negro" }] })
    }

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([
      expect.objectContaining({ productName: name, status: "created", createdSizes: ["N38", "N39", "N40", "N45", "N46"] }),
    ])
    expect(summary.variantsCreated).toBe(5)

    const variants = await variantsNamed(name)
    expect(variants).toHaveLength(9)
    for (const variant of variants) {
      expect(variant.isActive).toBe(true)
      expect(variant.unitOfMeasure).toBe("par")
      expect(variant.productAttributes.map((a) => a.name).sort()).toEqual(["Color", "Modelo", "Talla"])
      expect(variant.productSuppliers).toEqual([expect.objectContaining({ supplierId: SUPPLIER_ID, isPreferred: true })])
    }
    const created = variants.filter((v) => ["N38", "N39", "N40", "N45", "N46"].includes(resolveProductSize(v.productAttributes)!.label))
    expect(created.every((v) => v.productAttributes.find((a) => a.name === "Talla")!.sizeFamily === "calzado")).toBe(true)
    expect(new Set(variants.map((v) => v.sku)).size).toBe(9)

    // Lo que ve quien pide: un único selector de talla con 38..46 en orden.
    const options = variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, familyId: v.familyId, attributes: v.productAttributes })) as unknown as ProductOption[]
    const [group] = groupProductVariants(options)
    const picker = getSizeVariantPicker(group!.variants)
    expect(picker?.choices.map((c) => c.label)).toEqual(["N38", "N39", "N40", "N41", "N42", "N43", "N44", "N45", "N46"])
  })

  it("es idempotente", async () => {
    await createVariant({ name: "Bota PVC Segusa Pegasus", size: "41" })

    await completeSizeRanges()
    const second = await completeSizeRanges()

    expect(second.variantsCreated).toBe(0)
    expect(second.results).toEqual([expect.objectContaining({ status: "already_complete" })])
    expect((await sizesNamed("Bota PVC Segusa Pegasus")).sort()).toEqual([...FOOTWEAR_TARGET_SIZES].sort())
  })

  it("en dry-run informa y no escribe", async () => {
    await createVariant({ name: "Zapato de seguridad SteelPro", size: "42" })

    const summary = await completeSizeRanges({ dryRun: true })

    expect(summary.dryRun).toBe(true)
    expect(summary.variantsCreated).toBe(8)
    expect(await sizesNamed("Zapato de seguridad SteelPro")).toEqual(["42"])
  })

  it("completa un grupo con familia que declara 'calzado' aunque el nombre no diga botín, y conserva el 37", async () => {
    await inMemoryDb.insert(schema.eppProductFamilies).values({
      id: "fam-greta", categoryId: CATEGORY_ID, canonicalName: "Norseg Greta CT dama", identityKey: "k-greta",
    })
    await createVariant({ name: "Norseg Greta CT dama", size: "37", sizeAttrName: "Talla calzado", sizeFamily: "calzado", familyId: "fam-greta" })
    await createVariant({ name: "Norseg Greta CT dama", size: "38", sizeAttrName: "Talla calzado", sizeFamily: "calzado", familyId: "fam-greta" })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([
      expect.objectContaining({ groupKey: "fam-greta", createdSizes: ["39", "40", "41", "42", "43", "44", "45", "46"] }),
    ])
    expect((await sizesNamed("Norseg Greta CT dama")).sort()).toEqual(["37", ...FOOTWEAR_TARGET_SIZES].sort())
  })

  it("no recrea una talla dada de baja a mano", async () => {
    await createVariant({ name: "Botin Proflex aislante", size: "40" })
    await createVariant({ name: "Botin Proflex aislante", size: "45", isActive: false })

    const summary = await completeSizeRanges()

    expect(summary.results[0]!.createdSizes).not.toContain("45")
    expect(await sizesNamed("Botin Proflex aislante", { activeOnly: true })).not.toContain("45")
  })

  it("informa como 'unsized' el calzado sin talla en ninguna variante y no lo toca", async () => {
    await createVariant({ name: "Botin V-Flex Microfiber", size: null, extraAttrs: [{ name: "Color", value: "Negro" }] })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([expect.objectContaining({ status: "unsized", createdSizes: [] })])
    expect(await variantsNamed("Botin V-Flex Microfiber")).toHaveLength(1)
  })

  it("no toca guantes, una chaqueta por número ni un botín con talla de letra", async () => {
    await createVariant({ name: "Guante cabritilla", size: "N-9" })
    await createVariant({ name: "Chaqueta térmica", size: "42" })
    await createVariant({ name: "Botín de goma infantil", size: "L" })
    await createVariant({ name: "Bota de agua", size: "42", sizeFamily: "ropa" })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([])
    expect(summary.variantsCreated).toBe(0)
  })

  it("ignora un grupo de calzado dado de baja entero", async () => {
    await createVariant({ name: "Bota descontinuada", size: "41", isActive: false })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([])
  })
})

describe("completeSizeRanges · ropa", () => {
  async function pickerLabels(name: string) {
    const rows = (await variantsNamed(name)).filter((v) => v.isActive)
    const options = rows.map((v) => ({ id: v.id, name: v.name, sku: v.sku, familyId: v.familyId, attributes: v.productAttributes })) as unknown as ProductOption[]
    const groups = groupProductVariants(options)
    expect(groups).toHaveLength(1)
    return getSizeVariantPicker(groups[0]!.variants)?.choices.map((c) => c.label) ?? null
  }

  it("completa el chaleco geólogo, da de baja la fila sin talla y Solicitudes vuelve a ofrecer «Talla»", async () => {
    // El caso de producción: misma familia por nombre normalizado (tildes y
    // mayúsculas), una fila histórica sólo con Color y dos tallas T/L, T/S.
    const legacy = await createVariant({ name: "Chaleco Geologo Activex Gabardina Terra Bicolor", size: null, extraAttrs: [{ name: "Color", value: "Amarillo" }] })
    await createVariant({ name: "Chaleco geólogo Activex gabardina terra bicolor", size: "T/L", extraAttrs: [{ name: "Color", value: "Amarillo" }] })
    await createVariant({ name: "Chaleco geólogo Activex gabardina terra bicolor", size: "T/S", extraAttrs: [{ name: "Color", value: "Amarillo" }] })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([expect.objectContaining({
      sizeFamily: "ropa",
      status: "created",
      createdSizes: ["T/M", "T/XL", "T/2XL", "T/3XL"],
      retiredUnsized: ["EPP-001"],
      keptUnsized: [],
    })])
    const retired = await inMemoryDb.query.products.findFirst({ where: (p, { eq }) => eq(p.id, legacy) })
    expect(retired?.isActive).toBe(false)
    const audit = await inMemoryDb.query.auditLog.findMany({ where: (a, { eq }) => eq(a.entityId, legacy) })
    expect(audit).toHaveLength(1)

    expect(await pickerLabels("Chaleco geólogo Activex gabardina terra bicolor")).toEqual(["T/S", "T/M", "T/L", "T/XL", "T/2XL", "T/3XL"])
  })

  it("deja activa la fila sin talla que tiene stock, e informa por qué", async () => {
    const legacy = await createVariant({ name: "Polera Polo Dryfresh", size: null, extraAttrs: [{ name: "Color", value: "Azul piedra" }] })
    await createVariant({ name: "Polera Polo Dryfresh", size: "L" })
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Biodiversa", code: "FN-001" })
    await inMemoryDb.insert(schema.worksiteStock).values({ id: nanoid(), worksiteId: "ws-1", productId: legacy, quantity: 4 })

    const summary = await completeSizeRanges()

    expect(summary.results[0]).toEqual(expect.objectContaining({
      retiredUnsized: [],
      keptUnsized: [{ sku: "EPP-001", reason: "stock 4" }],
    }))
    expect((await inMemoryDb.query.products.findFirst({ where: (p, { eq }) => eq(p.id, legacy) }))?.isActive).toBe(true)
  })

  it("completa un pantalón como familia `pantalon` con el mismo rango", async () => {
    await createVariant({ name: "Pantalón Lightwind H3200", size: "T/XL" })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([expect.objectContaining({ sizeFamily: "pantalon", createdSizes: ["T/S", "T/M", "T/L", "T/2XL", "T/3XL"] })])
  })

  it("en dry-run no crea ni da de baja", async () => {
    const legacy = await createVariant({ name: "Chaqueta Micropolar", size: null })
    await createVariant({ name: "Chaqueta Micropolar", size: "M" })

    const summary = await completeSizeRanges({ dryRun: true })

    expect(summary).toEqual(expect.objectContaining({ dryRun: true, variantsCreated: 5, variantsRetired: 1 }))
    expect(await variantsNamed("Chaqueta Micropolar")).toHaveLength(2)
    expect((await inMemoryDb.query.products.findFirst({ where: (p, { eq }) => eq(p.id, legacy) }))?.isActive).toBe(true)
  })

  it("no toca un chaleco de talla única ni un casco", async () => {
    await createVariant({ name: "Chaleco reflectante", size: "Única" })
    await createVariant({ name: "Gorro legionario", size: "L" })

    const summary = await completeSizeRanges()

    expect(summary.results).toEqual([])
  })
})

describe("labelInGroupStyle", () => {
  it("copia el prefijo cuando todas las tallas lo comparten", () => {
    expect(labelInGroupStyle("38", ["N41", "N42"])).toBe("N38")
    expect(labelInGroupStyle("38", ["T-41"])).toBe("T-38")
  })

  it("copia el prefijo de la escala de letras", () => {
    expect(labelInGroupStyle("M", ["T/L", "T/S"])).toBe("T/M")
    expect(labelInGroupStyle("2XL", ["L", "S"])).toBe("2XL")
  })

  it("usa la forma canónica sin prefijo o con prefijos mezclados", () => {
    expect(labelInGroupStyle("2XL", ["XXXL", "L"])).toBe("2XL")
    expect(labelInGroupStyle("38", ["41", "42"])).toBe("38")
    expect(labelInGroupStyle("38", ["N41", "T41"])).toBe("38")
    expect(labelInGroupStyle("38", [])).toBe("38")
  })
})
