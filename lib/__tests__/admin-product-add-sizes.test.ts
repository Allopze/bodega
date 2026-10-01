/**
 * «Agregar tallas» desde cualquier producto del catálogo.
 *
 * El botón sólo existía para productos con `family_id`, y el catálogo importado
 * casi no la tiene: a un chaleco o un botín real no había cómo agregarle una
 * talla. `prepareAddVariantForProduct` resuelve la familia y la asigna a todo
 * el grupo por nombre —el mismo que ven Solicitudes y el listado—, y la firma
 * de combinaciones canoniza la talla para que una `L` nueva no conviva con la
 * `T/L` histórica.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
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

const { prepareAddVariantForProduct, createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
const { generateVariantCombos, filterNewVariantCombos } = await import("@/app/(app)/admin/productos/product-form.helpers")

const userId = nanoid()
const categoryId = nanoid()

function session(permissions = ["admin:products"]): Session {
  return {
    user: {
      id: userId, name: "Admin", email: "admin@chome.cl",
      permissions, roles: ["administrador"],
      worksiteIds: [], isGlobal: true, isActive: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

let skuSeq = 0
async function seedVariant(name: string, size: string | null, opts: { isEpp?: boolean } = {}) {
  const id = nanoid()
  await inMemoryDb.insert(schema.products).values({
    id, sku: `EPP-${String(++skuSeq).padStart(3, "0")}`, name, categoryId,
    unitOfMeasure: "unidad", isEpp: opts.isEpp ?? true, requiresPrevencion: true, isActive: true,
  })
  if (size) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: nanoid(), productId: id, name: "Talla", type: "select", isRequired: true, options: JSON.stringify([size]), sortOrder: 0,
    })
  }
  return id
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: "Elementos de protección personal", slug: `epp-${nanoid(4).toLowerCase()}`, isEpp: true,
  })
})

beforeEach(async () => {
  mockAuthFn.mockResolvedValue(session())
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.productSuppliers)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
})

describe("prepareAddVariantForProduct", () => {
  it("agrupa en una familia a todo el grupo por nombre y devuelve sus tallas", async () => {
    const legacy = await seedVariant("Chaleco Geologo Activex", null)
    const large = await seedVariant("Chaleco geólogo Activex", "T/L")
    const small = await seedVariant("Chaleco geólogo Activex", "T/S")
    const unrelated = await seedVariant("Chaleco reflectante", "M")

    const snapshot = await prepareAddVariantForProduct(large)

    expect(snapshot).not.toBeNull()
    const rows = await inMemoryDb.query.products.findMany()
    const familyOf = (id: string) => rows.find((row) => row.id === id)!.familyId
    expect(familyOf(legacy)).toBe(snapshot!.id)
    expect(familyOf(large)).toBe(snapshot!.id)
    expect(familyOf(small)).toBe(snapshot!.id)
    expect(familyOf(unrelated)).toBeNull()
    expect(snapshot!.attributes).toEqual([expect.objectContaining({ name: "Talla", values: expect.arrayContaining(["T/L", "T/S"]) })])

    const audit = await inMemoryDb.query.auditLog.findMany()
    expect(audit.map((row) => row.entityId).sort()).toEqual([legacy, large, small].sort())
  })

  it("no recrea una talla que ya existe escrita distinto, ni en el cliente ni en el servidor", async () => {
    const large = await seedVariant("Polera Polo Dryfresh", "T/L")
    const snapshot = (await prepareAddVariantForProduct(large))!

    const combos = generateVariantCombos(snapshot.canonicalName, [{ name: "Talla", type: "select", values: ["L", "M"] }])
    const { kept, removed } = filterNewVariantCombos(combos, snapshot.existingVariantKeys)
    expect(kept.map((combo) => combo.attributes[0]!.value)).toEqual(["M"])
    expect(removed.map((combo) => combo.attributes[0]!.value)).toEqual(["L"])

    const result = await createProductVariantBatch({
      categoryId, familyName: snapshot.canonicalName, unitOfMeasure: "unidad",
      isEpp: true, requiresPrevencion: true, isService: false, isActive: true,
      attributes: [{ name: "Talla", type: "select", values: ["L"] }],
      variants: [{ name: `${snapshot.canonicalName} L`, attributes: [{ name: "Talla", value: "L" }] }],
      familyId: snapshot.id, existingVariantKeys: snapshot.existingVariantKeys,
    } as unknown as Parameters<typeof createProductVariantBatch>[0])
    expect(result.ok).toBe(false)
  })

  it("reutiliza la familia que el producto ya tiene", async () => {
    const id = await seedVariant("Botín V-Flex V73", "N41")
    const first = (await prepareAddVariantForProduct(id))!
    const second = (await prepareAddVariantForProduct(id))!
    expect(second.id).toBe(first.id)
    expect(await inMemoryDb.query.eppProductFamilies.findMany()).toHaveLength(1)
  })

  it("no crea familias para un producto que no es EPP", async () => {
    const id = await seedVariant("Resma carta", null, { isEpp: false })
    expect(await prepareAddVariantForProduct(id)).toBeNull()
    expect(await inMemoryDb.query.eppProductFamilies.findMany()).toHaveLength(0)
  })

  it("exige el permiso de catálogo", async () => {
    const id = await seedVariant("Chaleco", "M")
    mockAuthFn.mockResolvedValue(session([]))
    expect(await prepareAddVariantForProduct(id)).toBeNull()
    expect((await inMemoryDb.query.products.findFirst())!.familyId).toBeNull()
  })
})
