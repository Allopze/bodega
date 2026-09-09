/**
 * `retireDuplicateSizeVariants` da de baja las variantes que representan la
 * misma talla física dentro de una familia, y **sólo** las que no tienen stock
 * ni historial: desactivar una variante con stock esconde inventario real.
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

const { retireDuplicateSizeVariants, findDuplicateSizeGroups } =
  await import("@/lib/services/epp-duplicate-size-reconciliation")

const CATEGORY_ID = "cat-epp"
const WORKSITE_ID = "faena-1"

async function seedBase() {
  await inMemoryDb.insert(schema.productCategories).values({
    id: CATEGORY_ID, name: "EPP", slug: "epp", isEpp: true, requiresPrevencion: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Uno", code: "FN-001",
  })
}

async function addFamily(familyId: string, canonicalName: string) {
  await inMemoryDb.insert(schema.eppProductFamilies).values({
    id: familyId, categoryId: CATEGORY_ID, canonicalName, identityKey: `key-${familyId}`,
  })
}

async function addVariant(input: {
  familyId: string
  sku: string
  size: string
  isActive?: boolean
  stock?: number
}) {
  const productId = `p-${input.sku}`
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: input.sku, name: "Producto", categoryId: CATEGORY_ID,
    familyId: input.familyId, isEpp: true, requiresPrevencion: true,
    isActive: input.isActive ?? true,
  })
  await inMemoryDb.insert(schema.productAttributes).values({
    id: nanoid(), productId, name: "Talla", type: "select",
    isRequired: true, options: JSON.stringify([input.size]), sortOrder: 0,
  })
  if (input.stock != null) {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: nanoid(), worksiteId: WORKSITE_ID, productId, quantity: input.stock,
    })
  }
  return productId
}

async function isActive(sku: string): Promise<boolean> {
  const row = await inMemoryDb.query.products.findFirst({ where: eq(schema.products.sku, sku) })
  return row!.isActive
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.productCategories)
  await seedBase()
})

describe("findDuplicateSizeGroups", () => {
  it("agrupa `N41` y `T41` como la misma talla 41", async () => {
    await addFamily("fam-botin", "Botín V-Flex Thinsulate V15")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41" })

    const groups = await findDuplicateSizeGroups()

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sizeLabel).toBe("41")
    expect(groups[0]!.retirable).toBe(true)
  })

  it("agrupa `L` y `T/L` como la misma talla L", async () => {
    await addFamily("fam-guante", "Guante Nitrilo")
    await addVariant({ familyId: "fam-guante", sku: "EPP-056", size: "T/L" })
    await addVariant({ familyId: "fam-guante", sku: "EPP-057", size: "L" })

    const groups = await findDuplicateSizeGroups()

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sizeLabel).toBe("L")
  })

  it("no agrupa tallas distintas de la misma familia", async () => {
    await addFamily("fam-camisa", "Camisa")
    await addVariant({ familyId: "fam-camisa", sku: "EPP-201", size: "T/S" })
    await addVariant({ familyId: "fam-camisa", sku: "EPP-202", size: "T/M" })

    expect(await findDuplicateSizeGroups()).toEqual([])
  })

  it("ignora las variantes ya dadas de baja", async () => {
    await addFamily("fam-botin", "Botín")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41", isActive: false })

    expect(await findDuplicateSizeGroups()).toEqual([])
  })
})

describe("retireDuplicateSizeVariants", () => {
  it("da de baja el duplicado sin stock ni historial", async () => {
    await addFamily("fam-botin", "Botín")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41" })

    const summary = await retireDuplicateSizeVariants({ dryRun: false })

    expect(summary.variantsRetired).toBe(1)
    expect(summary.groupsSkipped).toBe(0)
    expect(await isActive("EPP-021")).toBe(true)
    expect(await isActive("EPP-022")).toBe(false)
  })

  it("por omisión no escribe", async () => {
    await addFamily("fam-botin", "Botín")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41" })

    const summary = await retireDuplicateSizeVariants()

    expect(summary.dryRun).toBe(true)
    expect(summary.variantsRetired).toBe(1)
    expect(await isActive("EPP-022")).toBe(true)
  })

  it("nunca da de baja una variante con stock: salta el grupo", async () => {
    // Es el caso de `Guante Activex Nitrilo Heavy Duty` en bodega_dev: las dos
    // variantes tienen stock real, así que desactivar cualquiera esconde
    // inventario. Sobrevive la de más stock (la regla documentada), y el grupo
    // se salta igual porque la absorbida tampoco está vacía.
    await addFamily("fam-guante", "Guante Nitrilo")
    await addVariant({ familyId: "fam-guante", sku: "EPP-TRECK-022", size: "L", stock: 20 })
    await addVariant({ familyId: "fam-guante", sku: "EPP-056", size: "T/L", stock: 5 })

    const summary = await retireDuplicateSizeVariants({ dryRun: false })

    expect(summary.variantsRetired).toBe(0)
    expect(summary.groupsSkipped).toBe(1)
    expect(summary.groups[0]!.survivor.sku).toBe("EPP-TRECK-022")
    expect(summary.groups[0]!.skipReason).toContain("EPP-056")
    expect(await isActive("EPP-056")).toBe(true)
    expect(await isActive("EPP-TRECK-022")).toBe(true)
  })

  it("sobrevive la variante con stock cuando la otra no tiene nada", async () => {
    await addFamily("fam-traje", "Traje PU Verde")
    await addVariant({ familyId: "fam-traje", sku: "EPP-108", size: "T/L" })
    await addVariant({ familyId: "fam-traje", sku: "EPP-110", size: "T/L", stock: 2 })

    await retireDuplicateSizeVariants({ dryRun: false })

    expect(await isActive("EPP-110")).toBe(true)
    expect(await isActive("EPP-108")).toBe(false)
  })

  it("deja rastro en el audit log de cada baja", async () => {
    await addFamily("fam-botin", "Botín")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41" })

    await retireDuplicateSizeVariants({ dryRun: false, userId: null })

    const entries = await inMemoryDb.select().from(schema.auditLog)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.entityCode).toBe("EPP-022")
    expect(entries[0]!.reason).toContain("EPP-021")
  })

  it("es idempotente: la segunda corrida no encuentra nada", async () => {
    await addFamily("fam-botin", "Botín")
    await addVariant({ familyId: "fam-botin", sku: "EPP-021", size: "N41" })
    await addVariant({ familyId: "fam-botin", sku: "EPP-022", size: "T41" })

    await retireDuplicateSizeVariants({ dryRun: false })
    const second = await retireDuplicateSizeVariants({ dryRun: false })

    expect(second.groupsFound).toBe(0)
    expect(second.variantsRetired).toBe(0)
  })
})
