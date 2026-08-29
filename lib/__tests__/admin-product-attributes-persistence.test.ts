/**
 * P0: `updateProduct` borraba TODOS los atributos del producto y los
 * reinsertaba con ids nuevos. `request_item_attributes.attribute_id` apunta a
 * `product_attributes.id` con ON DELETE no action, así que cualquier atributo
 * que ya hubiera aparecido en una solicitud enviada hacía fallar el DELETE con
 * 23503 y dejaba el producto imposible de editar — 28 productos reales en
 * producción, incluidos SRV-ALCOTEST y SRV-MONOGAS.
 *
 * De paso el reinsert perdía `sizeFamily` y regeneraba los ids, rompiendo la
 * trazabilidad de las solicitudes históricas aunque el borrado pasara.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
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

/** Un producto con un atributo `select` (con sizeFamily) y uno `integer` driver. */
async function seedProduct(name: string) {
  const productId = nanoid()
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `PRD-${nanoid(6).toUpperCase()}`, name,
    categoryId, unitOfMeasure: "unidad", isActive: true,
  })
  const tallaId = nanoid()
  const dosisId = nanoid()
  await inMemoryDb.insert(schema.productAttributes).values([
    { id: tallaId, productId, name: "Talla", type: "select", isRequired: true,
      options: JSON.stringify(["M", "L"]), sizeFamily: "ropa", sortOrder: 0 },
    { id: dosisId, productId, name: "Dosis", type: "integer", isRequired: true,
      drivesQuantity: true, sortOrder: 1 },
  ])
  return { productId, tallaId, dosisId }
}

function editForm(productId: string, name: string, attributes: unknown[]) {
  const fd = new FormData()
  fd.set("id", productId)
  fd.set("name", name)
  fd.set("categoryId", categoryId)
  fd.set("unitOfMeasure", "unidad")
  fd.set("isActive", "on")
  fd.set("attributesJson", JSON.stringify(attributes))
  fd.set("suppliersJson", "[]")
  return fd
}

beforeAll(async () => {
  mockAuthFn.mockResolvedValue(session())
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: worksiteId, name: "Faena Test", code: `WS-${nanoid(4).toUpperCase()}`, isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: "EPP", slug: `epp-${nanoid(4).toLowerCase()}`,
  })
})

describe("updateProduct reconcilia atributos en vez de borrarlos", () => {
  it("conserva sizeFamily y el id del atributo al renombrar el producto", async () => {
    const { productId, tallaId, dosisId } = await seedProduct("Casco")

    const result = await updateProduct({ ok: false }, editForm(productId, "Casco renombrado", [
      { id: tallaId, name: "Talla", type: "select", isRequired: true, options: '["M","L"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: dosisId, name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 1 },
    ]))

    expect(result.ok).toBe(true)
    const attrs = await inMemoryDb.select().from(schema.productAttributes)
      .where(eq(schema.productAttributes.productId, productId))

    const talla = attrs.find((a) => a.name === "Talla")
    expect(talla?.id).toBe(tallaId)          // el id sobrevive: la trazabilidad no se rompe
    expect(talla?.sizeFamily).toBe("ropa")   // antes se perdía en el reinsert

    const dosis = attrs.find((a) => a.name === "Dosis")
    expect(dosis?.id).toBe(dosisId)
    expect(dosis?.type).toBe("integer")
    expect(dosis?.drivesQuantity).toBe(true)
  })

  it("deja editar un producto cuyos atributos ya aparecen en una solicitud (el P0)", async () => {
    const { productId, tallaId, dosisId } = await seedProduct("Servicio con historial")

    // Una solicitud enviada que referencia el atributo: esto es lo que hacía
    // reventar el DELETE con 23503.
    const requestId = nanoid()
    const itemId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid(6).toUpperCase()}`, worksiteId,
      requesterId: userId, status: "submitted",
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productId, quantity: 1, unitOfMeasure: "unidad",
    })
    await inMemoryDb.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: itemId, attributeId: tallaId,
      attributeName: "Talla", value: "M",
    })

    const result = await updateProduct({ ok: false }, editForm(productId, "Servicio editado", [
      { id: tallaId, name: "Talla", type: "select", isRequired: true, options: '["M","L","XL"]', sizeFamily: "ropa", sortOrder: 0 },
      { id: dosisId, name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 1 },
    ]))

    expect(result.ok).toBe(true)
    const [product] = await inMemoryDb.select().from(schema.products).where(eq(schema.products.id, productId))
    expect(product!.name).toBe("Servicio editado")

    // La referencia de la solicitud sigue apuntando al mismo atributo.
    const [link] = await inMemoryDb.select().from(schema.requestItemAttributes)
      .where(eq(schema.requestItemAttributes.requestItemId, itemId))
    expect(link!.attributeId).toBe(tallaId)
  })

  it("explica por qué no puede quitar un atributo con historial, en vez de reventar", async () => {
    const { productId, tallaId, dosisId } = await seedProduct("Producto con historial")

    const requestId = nanoid()
    const itemId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid(6).toUpperCase()}`, worksiteId,
      requesterId: userId, status: "submitted",
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productId, quantity: 1, unitOfMeasure: "unidad",
    })
    await inMemoryDb.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: itemId, attributeId: tallaId,
      attributeName: "Talla", value: "M",
    })

    // Se envía el formulario SIN "Talla": el usuario intenta quitarla.
    const result = await updateProduct({ ok: false }, editForm(productId, "Producto con historial", [
      { id: dosisId, name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 0 },
    ]))

    expect(result.ok).toBe(false)
    expect(result.message).toContain("Talla")
    expect(result.message).toContain("solicitudes")

    // Y no dejó el producto a medio actualizar.
    const attrs = await inMemoryDb.select().from(schema.productAttributes)
      .where(eq(schema.productAttributes.productId, productId))
    expect(attrs.some((a) => a.id === tallaId)).toBe(true)
  })

  it("mueve el driver de cantidad de un atributo a otro sin violar el índice único", async () => {
    const { productId, tallaId, dosisId } = await seedProduct("Producto con driver móvil")

    const result = await updateProduct({ ok: false }, editForm(productId, "Producto con driver móvil", [
      { id: tallaId, name: "Talla", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 0 },
      { id: dosisId, name: "Dosis", type: "integer", isRequired: true, drivesQuantity: false, sortOrder: 1 },
    ]))

    expect(result.ok).toBe(true)
    const attrs = await inMemoryDb.select().from(schema.productAttributes)
      .where(eq(schema.productAttributes.productId, productId))
    expect(attrs.filter((a) => a.drivesQuantity).map((a) => a.name)).toEqual(["Talla"])
  })
})

describe("createProductVariantBatch conserva lo que el formulario declara", () => {
  it("escribe sizeFamily en cada variante y equipmentKind en el producto", async () => {
    const result = await createProductVariantBatch({
      categoryId,
      familyName: "Guante de prueba",
      unitOfMeasure: "par",
      isEpp: true,
      isService: true,
      equipmentKind: "monogas",
      isActive: true,
      attributes: [
        { name: "Talla", type: "select", options: JSON.stringify(["M", "L"]), sizeFamily: "guantes", sortOrder: 0 },
      ],
      variants: [
        { name: "Guante de prueba M", attributes: [{ name: "Talla", value: "M" }] },
        { name: "Guante de prueba L", attributes: [{ name: "Talla", value: "L" }] },
      ],
    })

    expect(result.ok).toBe(true)

    const created = await inMemoryDb.select().from(schema.products)
      .where(eq(schema.products.categoryId, categoryId))
    const variants = created.filter((p) => p.name.startsWith("Guante de prueba"))
    expect(variants).toHaveLength(2)

    for (const variant of variants) {
      expect(variant.equipmentKind).toBe("monogas")   // antes siempre quedaba null
      const attrs = await inMemoryDb.select().from(schema.productAttributes)
        .where(eq(schema.productAttributes.productId, variant.id))
      expect(attrs[0]!.sizeFamily).toBe("guantes")    // el payload `attributes` era carga muerta
    }
  })
})

describe("editor de atributos avanzados: el driver de cantidad llega a la BD", () => {
  function createForm(name: string, attributes: unknown[]) {
    const fd = new FormData()
    fd.set("name", name)
    fd.set("categoryId", categoryId)
    fd.set("unitOfMeasure", "unidad")
    fd.set("isActive", "on")
    fd.set("attributesJson", JSON.stringify(attributes))
    fd.set("suppliersJson", "[]")
    return fd
  }

  it("crea un producto con un atributo entero que gobierna la cantidad", async () => {
    const result = await createProduct({ ok: false }, createForm("Vacuna antitetánica", [
      { name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 0 },
    ]))

    expect(result.ok).toBe(true)
    const [product] = await inMemoryDb.select().from(schema.products)
      .where(eq(schema.products.name, "Vacuna antitetánica"))
    const attrs = await inMemoryDb.select().from(schema.productAttributes)
      .where(eq(schema.productAttributes.productId, product!.id))

    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toMatchObject({ name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true })
  })

  it("rechaza dos atributos que gobiernan la cantidad, con mensaje legible", async () => {
    const result = await createProduct({ ok: false }, createForm("Producto con dos drivers", [
      { name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 0 },
      { name: "Sesiones", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 1 },
    ]))

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result.fieldErrors)).toContain("Solo un atributo")
  })

  it("rechaza un driver que no es entero obligatorio", async () => {
    const result = await createProduct({ ok: false }, createForm("Driver mal tipado", [
      { name: "Dosis", type: "text", isRequired: false, drivesQuantity: true, sortOrder: 0 },
    ]))

    expect(result.ok).toBe(false)
  })

  it("rechaza dos atributos con el mismo nombre (se pisan al resolver por nombre)", async () => {
    const result = await createProduct({ ok: false }, createForm("Producto con nombre repetido", [
      { name: "Talla", type: "select", isRequired: true, options: '["M"]', sortOrder: 0 },
      { name: " TÁLLA ", type: "text", isRequired: false, sortOrder: 1 },
    ]))

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result.fieldErrors)).toContain("mismo nombre")
  })

  it("el lote copia el driver a cada variante", async () => {
    const result = await createProductVariantBatch({
      categoryId,
      familyName: "Vacuna por lote",
      unitOfMeasure: "unidad",
      isEpp: false,
      isActive: true,
      attributes: [
        { name: "Presentación", type: "select", options: JSON.stringify(["Frasco", "Jeringa"]), sortOrder: 0 },
      ],
      advancedAttributes: [
        { name: "Dosis", type: "integer", isRequired: true, drivesQuantity: true, sortOrder: 1 },
      ],
      variants: [
        { name: "Vacuna por lote Frasco", attributes: [{ name: "Presentación", value: "Frasco" }] },
        { name: "Vacuna por lote Jeringa", attributes: [{ name: "Presentación", value: "Jeringa" }] },
      ],
    })

    expect(result.ok).toBe(true)
    const created = await inMemoryDb.select().from(schema.products)
      .where(eq(schema.products.categoryId, categoryId))
    const variants = created.filter((p) => p.name.startsWith("Vacuna por lote"))
    expect(variants).toHaveLength(2)

    for (const variant of variants) {
      const attrs = await inMemoryDb.select().from(schema.productAttributes)
        .where(eq(schema.productAttributes.productId, variant.id))
      const driver = attrs.find((a) => a.drivesQuantity)
      expect(driver).toMatchObject({ name: "Dosis", type: "integer", isRequired: true })
    }
  })
})

describe("alta de familia EPP a prueba de carreras", () => {
  it("se suma a la familia existente en vez de reventar con 23505", async () => {
    const { ensureEppFamilyTx } = await import("@/app/(app)/admin/productos/actions/helpers")
    const { buildEppFamilyIdentityKey } = await import("@/lib/services/epp-import")

    const canonicalName = `Casco carrera ${nanoid(6)}`
    const identityKey = buildEppFamilyIdentityKey({
      categoryName: "EPP", canonicalName, brand: null, model: null,
    })

    // Simula al que GANÓ la carrera: la fila ya está cuando llega el segundo.
    const winnerId = nanoid()
    await inMemoryDb.insert(schema.eppProductFamilies).values({
      id: winnerId, categoryId, canonicalName, identityKey,
    })

    const resolved = await inMemoryDb.transaction(async (tx) =>
      // @ts-expect-error — PGlite es estructuralmente compatible en runtime.
      ensureEppFamilyTx(tx, { categoryId, categoryName: "EPP", canonicalName }),
    )

    expect(resolved.id).toBe(winnerId)
    const all = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.identityKey, identityKey))
    expect(all).toHaveLength(1)   // no se duplicó la familia
  })

  it("crea la familia cuando no existe", async () => {
    const { ensureEppFamilyTx } = await import("@/app/(app)/admin/productos/actions/helpers")
    const canonicalName = `Casco nuevo ${nanoid(6)}`

    const resolved = await inMemoryDb.transaction(async (tx) =>
      // @ts-expect-error — PGlite es estructuralmente compatible en runtime.
      ensureEppFamilyTx(tx, { categoryId, categoryName: "EPP", canonicalName }),
    )

    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, resolved.id))
    expect(family?.canonicalName).toBe(canonicalName)
  })
})
