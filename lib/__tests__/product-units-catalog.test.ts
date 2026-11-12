/**
 * Las unidades de medida son una lista fija en código (`PRODUCT_UNITS`,
 * `lib/products/units.ts`) y la tabla `product_units` es sólo el destino de la
 * FK de `products.unit_of_measure`. Esta prueba es lo que evita que se separen:
 * si alguien agrega una unidad a la lista sin la migración que la inserta, el
 * formulario la ofrecería y la base la rechazaría al guardar.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { PRODUCT_UNITS, PRODUCT_UNIT_CODES } from "@/lib/products/units"
import { VALID_UNITS, UNIT_ALIASES } from "@/lib/services/epp-import.types"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

describe("unidades de medida: lista fija y tabla de la FK", () => {
  it("cada unidad de la lista existe en product_units, activa y con su rótulo", async () => {
    const rows = await inMemoryDb.select().from(schema.productUnits)
    const byCode = new Map(rows.map((row) => [row.code, row]))

    const mismatches = PRODUCT_UNITS.flatMap((unit) => {
      const row = byCode.get(unit.code)
      if (!row) return [`${unit.code}: falta en product_units`]
      if (!row.isActive) return [`${unit.code}: inactiva`]
      if (row.label !== unit.label) return [`${unit.code}: rótulo «${row.label}» ≠ «${unit.label}»`]
      return []
    })
    expect(mismatches).toEqual([])
  })

  it("los códigos de la lista son únicos y ya normalizados", () => {
    expect(new Set(PRODUCT_UNIT_CODES).size).toBe(PRODUCT_UNIT_CODES.length)
    for (const code of PRODUCT_UNIT_CODES) {
      expect(code).toBe(code.trim().toLowerCase())
    }
  })

  it("el importador EPP acepta exactamente la lista", () => {
    expect([...VALID_UNITS]).toEqual([...PRODUCT_UNIT_CODES])
  })

  it("todo alias del importador resuelve a una unidad de la lista", () => {
    const codes = new Set<string>(PRODUCT_UNIT_CODES)
    const dangling = Object.entries(UNIT_ALIASES)
      .filter(([, target]) => !codes.has(target))
      .map(([alias, target]) => `${alias} → ${target}`)
    expect(dangling).toEqual([])
  })

  it("la tabla de plantillas de atributos ya no existe", async () => {
    const result = await pg.query<{ exists: boolean }>(
      "select to_regclass('public.product_attribute_templates') is not null as exists",
    )
    expect(result.rows[0]?.exists).toBe(false)
  })
})
