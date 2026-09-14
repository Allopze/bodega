/**
 * Patrón P2 y P1 del catálogo (auditoría 2026-09-14).
 *
 * `CAT-001`: desactivar un producto con saldo lo inmoviliza —la entrega lo
 * rechaza, la guía no lo ofrece, la solicitud lo filtra— mientras su inventario
 * sigue contando en el kardex y en la valorización.
 *
 * `CAT-002`: la unidad de medida y las condiciones de EPP/servicio viajaban en
 * el mismo `UPDATE` que el nombre, sin comprobar uso previo, y reinterpretan
 * hacia atrás lo ya registrado.
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

const { updateProduct, toggleProductActive, bulkToggleProductActiveAction } =
  await import("@/app/(app)/admin/productos/actions")

const userId = nanoid()
const wsNorte = nanoid()
const wsSur = nanoid()
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

async function seedProduct(name: string, overrides: Partial<typeof schema.products.$inferInsert> = {}) {
  const productId = nanoid()
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `PRD-${nanoid(6).toUpperCase()}`, name,
    categoryId, unitOfMeasure: "unidad", isActive: true, ...overrides,
  })
  return productId
}

async function withStock(productId: string, worksiteId: string, quantity: number) {
  await inMemoryDb.insert(schema.worksiteStock).values({
    id: nanoid(), productId, worksiteId, quantity,
  })
}

function editForm(productId: string, fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("id", productId)
  fd.set("name", "Producto")
  fd.set("categoryId", categoryId)
  fd.set("unitOfMeasure", "unidad")
  fd.set("isActive", "on")
  fd.set("attributesJson", "[]")
  fd.set("suppliersJson", "[]")
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const toggleForm = (id: string, activate: boolean) => {
  const fd = new FormData()
  fd.set("id", id); fd.set("activate", String(activate))
  return fd
}

const isActive = async (productId: string) =>
  (await inMemoryDb.select({ a: schema.products.isActive })
    .from(schema.products).where(eq(schema.products.id, productId)))[0]?.a

beforeAll(async () => {
  mockAuthFn.mockResolvedValue(session())
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: wsNorte, name: "Faena Norte", code: `WN-${nanoid(4).toUpperCase()}`, isActive: true },
    { id: wsSur, name: "Faena Sur", code: `WS-${nanoid(4).toUpperCase()}`, isActive: true },
  ])
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: "EPP", slug: `epp-${nanoid(4).toLowerCase()}`,
  })
})

describe("CAT-001 — desactivar un producto con saldo", () => {
  it("un producto sin saldo se desactiva sin ceremonia", async () => {
    const id = await seedProduct("Sin saldo")
    expect((await toggleProductActive({ ok: false }, toggleForm(id, false))).ok).toBe(true)
    expect(await isActive(id)).toBe(false)
  })

  it("un saldo en cero no bloquea: no hay inventario que esconder", async () => {
    const id = await seedProduct("Saldo cero")
    await withStock(id, wsNorte, 0)
    expect((await toggleProductActive({ ok: false }, toggleForm(id, false))).ok).toBe(true)
    expect(await isActive(id)).toBe(false)
  })

  it("con saldo se rechaza, y el mensaje dice cuánto y dónde", async () => {
    const id = await seedProduct("Casco con saldo")
    await withStock(id, wsNorte, 12)
    await withStock(id, wsSur, 3)

    const result = await toggleProductActive({ ok: false }, toggleForm(id, false))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Casco con saldo")
    expect(result.message).toContain("15")               // 12 + 3
    expect(result.message).toContain("Faena Norte")
    expect(result.message).toContain("Faena Sur")
    expect(await isActive(id)).toBe(true)                // y no se desactivó
  })

  it("reactivar nunca se bloquea: sacar el freno no esconde nada", async () => {
    const id = await seedProduct("Reactivable", { isActive: false })
    await withStock(id, wsNorte, 5)
    expect((await toggleProductActive({ ok: false }, toggleForm(id, true))).ok).toBe(true)
    expect(await isActive(id)).toBe(true)
  })

  it("el lote es todo o nada: un solo producto con saldo detiene los cien", async () => {
    const limpio1 = await seedProduct("Lote limpio 1")
    const limpio2 = await seedProduct("Lote limpio 2")
    const conSaldo = await seedProduct("Lote con saldo")
    await withStock(conSaldo, wsNorte, 7)

    const fd = new FormData()
    fd.set("ids", [limpio1, conSaldo, limpio2].join(","))
    fd.set("activate", "false")

    const result = await bulkToggleProductActiveAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Lote con saldo")
    // Ninguno se movió: desactivar "los que se puedan" dejaría a quien lo pidió
    // sin saber cuáles quedaron fuera.
    expect(await isActive(limpio1)).toBe(true)
    expect(await isActive(limpio2)).toBe(true)
    expect(await isActive(conSaldo)).toBe(true)
  })
})

describe("CAT-002 — identidad de medida y naturaleza del producto", () => {
  it("sin historia, la unidad de medida se puede corregir", async () => {
    const id = await seedProduct("Recién creado")
    const result = await updateProduct({ ok: false }, editForm(id, { unitOfMeasure: "caja" }))
    expect(result.ok).toBe(true)
  })

  it("con inventario, cambiar la unidad se rechaza sobre su propio campo", async () => {
    const id = await seedProduct("Con inventario")
    await withStock(id, wsNorte, 40)

    const result = await updateProduct({ ok: false }, editForm(id, { unitOfMeasure: "caja" }))
    expect(result.ok).toBe(false)
    const mensaje = result.fieldErrors?.unitOfMeasure?.[0] ?? ""
    expect(mensaje).toContain("la unidad de medida")
    expect(mensaje).toContain("«unidad» → «caja»")
    expect(mensaje).toContain("Crea otro producto")
  })

  it("con inventario, marcarlo como servicio también se rechaza", async () => {
    const id = await seedProduct("Físico con saldo")
    await withStock(id, wsNorte, 4)

    const result = await updateProduct({ ok: false }, editForm(id, { isService: "on" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.isService?.[0]).toContain("la condición de servicio")
  })

  it("con inventario, el nombre y las notas se siguen pudiendo corregir", async () => {
    // El bloqueo es de identidad, no de edición: si impidiera corregir un
    // nombre mal escrito sería una molestia, no un control.
    const id = await seedProduct("Nombre con falta de ortografia")
    await withStock(id, wsNorte, 9)

    const result = await updateProduct({ ok: false }, editForm(id, { name: "Nombre corregido" }))
    expect(result.ok).toBe(true)
    const [row] = await inMemoryDb.select({ n: schema.products.name })
      .from(schema.products).where(eq(schema.products.id, id))
    expect(row?.n).toBe("Nombre corregido")
  })

  it("una solicitud pasada basta como historia, aunque ya no quede saldo", async () => {
    const id = await seedProduct("Usado y agotado")
    const requestId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid(6).toUpperCase()}`, worksiteId: wsNorte,
      requesterId: userId, status: "submitted",
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: nanoid(), requestId, productId: id, quantity: 1,
      unitOfMeasure: "unidad", status: "requested", sortOrder: 0,
    })

    const result = await updateProduct({ ok: false }, editForm(id, { unitOfMeasure: "caja" }))
    expect(result.ok).toBe(false)
  })
})
