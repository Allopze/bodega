/**
 * `backfillEppLogo` deja `Logo: Con logo` en las prendas EPP que lo llevan y en
 * sus solicitudes abiertas. Lo que más pesa aquí es lo que NO hace: no borra el
 * atributo que una solicitud referencia, no toca calzado y no toca ítems que
 * ya están en una OC.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

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

const { backfillEppLogo } = await import("@/lib/services/epp-logo-backfill")

const now = new Date().toISOString()
const LOGO = JSON.stringify(["Con logo"])

async function seedBase() {
  await inMemoryDb.insert(schema.productCategories).values({
    id: "cat", name: "Ropa de trabajo", slug: "ropa-de-trabajo", isEpp: true, requiresPrevencion: true,
  })
  await inMemoryDb.insert(schema.users).values({ id: "u1", name: "Sol", email: "sol@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.worksites).values({ id: "ws", name: "Faena", code: "FA", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id: "req", code: "SOL-1", worksiteId: "ws", requesterId: "u1", requestType: "epp", status: "in_purchasing", createdAt: now, updatedAt: now,
  })
}

async function product(id: string, name: string, attrs: Array<[string, string]>, opts: { familyId?: string; isActive?: boolean } = {}) {
  await inMemoryDb.insert(schema.products).values({
    id, sku: `SKU-${id}`, name, categoryId: "cat", isEpp: true, requiresPrevencion: true,
    familyId: opts.familyId ?? null, isActive: opts.isActive ?? true,
  })
  let sortOrder = 0
  for (const [attrName, value] of attrs) {
    await inMemoryDb.insert(schema.productAttributes).values({
      id: `${id}-${attrName}`, productId: id, name: attrName, type: "select",
      isRequired: true, options: JSON.stringify([value]), sortOrder: sortOrder++,
    })
  }
}

async function item(id: string, productId: string, status: string, attrs: Array<{ name: string; value: string; attributeId?: string }> = []) {
  await inMemoryDb.insert(schema.purchaseRequestItems).values({
    id, requestId: "req", productId, quantity: 1, unitOfMeasure: "unidad", status, createdAt: now, updatedAt: now,
  })
  for (const [index, attr] of attrs.entries()) {
    await inMemoryDb.insert(schema.requestItemAttributes).values({
      id: `${id}-a${index}`, requestItemId: id, attributeId: attr.attributeId ?? null, attributeName: attr.name, value: attr.value,
    })
  }
}

const attributesOf = (productId: string) =>
  inMemoryDb.query.productAttributes.findMany({ where: eq(schema.productAttributes.productId, productId) })
const itemAttributesOf = (requestItemId: string) =>
  inMemoryDb.query.requestItemAttributes.findMany({ where: eq(schema.requestItemAttributes.requestItemId, requestItemId) })

beforeEach(async () => {
  await inMemoryDb.delete(schema.requestItemAttributes)
  await inMemoryDb.delete(schema.purchaseRequestItems)
  await inMemoryDb.delete(schema.purchaseRequests)
  await inMemoryDb.delete(schema.productAttributes)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.eppProductFamilies)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.delete(schema.productCategories)
  await seedBase()
})

describe("backfillEppLogo", () => {
  it("el dry-run informa lo mismo que --apply pero no escribe nada", async () => {
    await product("p1", "Polera manga larga", [["Modelo", "Con logo Chome"], ["Talla", "M"]])
    await product("p2", "Pantalón cargo", [["Talla", "M"]])
    await item("i1", "p2", "requested")

    const dry = await backfillEppLogo({ dryRun: true })

    expect(dry).toMatchObject({ dryRun: true, catalog: { renamed: 1, inserted: 1 }, requestItems: { inserted: 1 } })
    expect((await attributesOf("p1")).find((a) => a.id === "p1-Modelo")?.name).toBe("Modelo")
    expect(await attributesOf("p2")).toHaveLength(1)
    expect(await itemAttributesOf("i1")).toHaveLength(0)

    const applied = await backfillEppLogo()
    expect({ ...applied, dryRun: true }).toEqual(dry)
  })

  it("renombra «Modelo: Con logo Chome» en el lugar y una solicitud que lo referencia sigue válida", async () => {
    await product("p1", "Polera manga larga", [["Modelo", "Con logo Chome"], ["Talla", "M"]])
    await item("i1", "p1", "in_purchase_order", [{ name: "Modelo", value: "Con logo Chome", attributeId: "p1-Modelo" }])

    await backfillEppLogo()

    const attrs = await attributesOf("p1")
    const renamed = attrs.find((a) => a.id === "p1-Modelo")
    expect(renamed).toMatchObject({ name: "Logo", type: "select", options: LOGO })
    expect(attrs).toHaveLength(2)
    // La FK sigue apuntando a una fila viva; el ítem en OC no se tocó.
    expect(await itemAttributesOf("i1")).toEqual([
      expect.objectContaining({ attributeId: "p1-Modelo", attributeName: "Modelo", value: "Con logo Chome" }),
    ])
  })

  it("inserta Logo donde falta, normaliza uno existente y no toca un botín", async () => {
    await product("p1", "Camisa de trabajo", [["Talla", "L"]])
    await product("p2", "Chaleco geólogo", [["Logo", "con logo"], ["Talla", "L"]])
    await product("p3", "Botín de seguridad", [["Talla", "42"]])

    const summary = await backfillEppLogo()

    expect(summary.catalog).toEqual({ eligibleProducts: 2, renamed: 1, inserted: 1, alreadyOk: 0 })
    expect((await attributesOf("p1")).find((a) => a.name === "Logo")).toMatchObject({ options: LOGO, isRequired: true, type: "select" })
    expect((await attributesOf("p2")).find((a) => a.name === "Logo")?.options).toBe(LOGO)
    expect(await attributesOf("p3")).toHaveLength(1)
    expect(summary.products.map((p) => [p.sku, p.action]).sort()).toEqual([["SKU-p1", "inserted"], ["SKU-p2", "normalized"]])
  })

  it("en un ítem requested convierte el Modelo registrado o inserta Logo, apuntando al atributo del producto", async () => {
    await product("p1", "Polera manga larga", [["Modelo", "Con logo"], ["Talla", "M"]])
    await product("p2", "Pantalón cargo", [["Talla", "M"]])
    await item("i1", "p1", "requested", [{ name: "Modelo", value: "Con logo", attributeId: "p1-Modelo" }, { name: "Talla", value: "M" }])
    await item("i2", "p2", "approved", [{ name: "Talla", value: "M" }])
    await item("i3", "p2", "pending_purchase")

    const summary = await backfillEppLogo()

    expect(summary.requestItems).toEqual({ updated: 1, inserted: 2, alreadyOk: 0 })
    const i1 = await itemAttributesOf("i1")
    expect(i1).toHaveLength(2)
    expect(i1.find((a) => a.attributeName === "Logo")).toMatchObject({ value: "Con logo", attributeId: "p1-Modelo" })
    const p2Logo = (await attributesOf("p2")).find((a) => a.name === "Logo")!
    for (const id of ["i2", "i3"]) {
      expect((await itemAttributesOf(id)).find((a) => a.attributeName === "Logo")).toMatchObject({ value: "Con logo", attributeId: p2Logo.id })
    }
  })

  it("no toca los ítems en OC o posteriores", async () => {
    await product("p1", "Pantalón cargo", [["Talla", "M"]])
    await item("i1", "p1", "in_purchase_order", [{ name: "Talla", value: "M" }])
    await item("i2", "p1", "received")

    const summary = await backfillEppLogo()

    expect(summary.requestItems).toEqual({ updated: 0, inserted: 0, alreadyOk: 0 })
    expect(await itemAttributesOf("i1")).toHaveLength(1)
    expect(await itemAttributesOf("i2")).toHaveLength(0)
  })

  it("informa las variantes que quedan duplicadas por talla en la misma familia", async () => {
    await inMemoryDb.insert(schema.eppProductFamilies).values({ id: "fam", categoryId: "cat", canonicalName: "Camisa H2600", identityKey: "k-fam" })
    await product("p1", "Camisa H2600", [["Modelo", "Con logo"], ["Talla", "M"]], { familyId: "fam" })
    await product("p2", "Camisa H2600", [["Modelo", "H2600"], ["Talla", "M"]], { familyId: "fam" })
    await product("p3", "Camisa H2600", [["Modelo", "H2600"], ["Talla", "L"]], { familyId: "fam" })

    const summary = await backfillEppLogo()

    expect(summary.duplicateSizes).toEqual([
      { groupKey: "fam", productName: "Camisa H2600", size: "M", skus: ["SKU-p1", "SKU-p2"] },
    ])
  })

  it("es idempotente: la segunda corrida no cambia nada", async () => {
    await product("p1", "Polera manga larga", [["Modelo", "Con logo Chome"], ["Talla", "M"]])
    await product("p2", "Pantalón cargo", [["Talla", "M"]])
    await item("i1", "p2", "requested")
    await backfillEppLogo()

    const second = await backfillEppLogo()

    expect(second.catalog).toEqual({ eligibleProducts: 2, renamed: 0, inserted: 0, alreadyOk: 2 })
    expect(second.requestItems).toEqual({ updated: 0, inserted: 0, alreadyOk: 1 })
    expect(second.products).toEqual([])
    expect(await itemAttributesOf("i1")).toHaveLength(1)
  })
})
