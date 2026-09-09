/**
 * `syncSizeCatalog` deja `size_catalog` al día con la semilla sin revivir lo
 * que alguien dio de baja a mano, y con el `display_order` derivado del
 * comparador —que es lo que `lib/products/size-catalog.ts` declara: «el
 * `display_order` de la base es un derivado del comparador, no una segunda
 * opinión sobre en qué orden van las tallas».
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
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

const { syncSizeCatalog } = await import("@/lib/services/sizes")

async function codesOf(family: string): Promise<string[]> {
  const rows = await inMemoryDb
    .select({ code: schema.sizeCatalog.code })
    .from(schema.sizeCatalog)
    .where(eq(schema.sizeCatalog.family, family))
    .orderBy(asc(schema.sizeCatalog.displayOrder))
  return rows.map((row) => row.code)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.sizeCatalog)
})

describe("syncSizeCatalog", () => {
  it("siembra una tabla vacía en orden de talla", async () => {
    const result = await syncSizeCatalog()

    expect(result.created).toBeGreaterThan(0)
    expect(await codesOf("ropa")).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"])
    expect(await codesOf("calzado")).toEqual(["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"])
  })

  it("es idempotente: correrlo dos veces no crea nada nuevo", async () => {
    await syncSizeCatalog()
    const second = await syncSizeCatalog()

    expect(second.created).toBe(0)
    expect(await codesOf("ropa")).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"])
  })

  it("no revive una talla dada de baja a mano", async () => {
    await syncSizeCatalog()
    await inMemoryDb
      .update(schema.sizeCatalog)
      .set({ isActive: false })
      .where(eq(schema.sizeCatalog.code, "4XL"))

    await syncSizeCatalog()

    const row = await inMemoryDb.query.sizeCatalog.findFirst({
      where: eq(schema.sizeCatalog.code, "4XL"),
    })
    expect(row?.isActive).toBe(false)
  })

  it("reordena la familia cuando la talla nueva va al medio de las que ya estaban", async () => {
    // Es el estado real de `bodega_dev`: la migración 0088 sembró `guantes`
    // con S, M, L, XL (órdenes 0..3) y la semilla después agregó XS y 2XL. Al
    // insertar sólo lo que falta, el XS entraba con el orden que le toca en la
    // semilla (0) y empataba con el S, así que la familia salía «S, XS, M…».
    await inMemoryDb.insert(schema.sizeCatalog).values([
      { id: "g-s", family: "guantes", code: "S", displayOrder: 0 },
      { id: "g-m", family: "guantes", code: "M", displayOrder: 1 },
      { id: "g-l", family: "guantes", code: "L", displayOrder: 2 },
      { id: "g-xl", family: "guantes", code: "XL", displayOrder: 3 },
    ])

    await syncSizeCatalog()

    expect(await codesOf("guantes")).toEqual(["XS", "S", "M", "L", "XL", "2XL"])
  })

  it("ordena también las tallas que no están en la semilla", async () => {
    // Una talla agregada a mano no se borra ni queda fuera del orden: el
    // comparador decide su lugar igual que para las de la semilla.
    await inMemoryDb.insert(schema.sizeCatalog).values([
      { id: "c-47", family: "calzado", code: "47", displayOrder: 99 },
    ])

    await syncSizeCatalog()

    const codes = await codesOf("calzado")
    expect(codes[codes.length - 1]).toBe("47")
    expect(codes.slice(0, 3)).toEqual(["36", "37", "38"])
  })

  it("deja el display_order sin huecos ni empates", async () => {
    await inMemoryDb.insert(schema.sizeCatalog).values([
      { id: "g-s", family: "guantes", code: "S", displayOrder: 0 },
      { id: "g-xl", family: "guantes", code: "XL", displayOrder: 3 },
    ])

    await syncSizeCatalog()

    const rows = await inMemoryDb
      .select({ order: schema.sizeCatalog.displayOrder })
      .from(schema.sizeCatalog)
      .where(eq(schema.sizeCatalog.family, "guantes"))
      .orderBy(asc(schema.sizeCatalog.displayOrder))
    expect(rows.map((row) => row.order)).toEqual([...rows.keys()])
  })
})
