/**
 * `VALID_UNITS` (importador EPP) y la siembra de `product_units` (migración
 * 0228) son forzosamente dos copias: el módulo del importador es libre de
 * `@/db` a propósito porque lo importan componentes cliente, así que no puede
 * leer el catálogo. Esta prueba es lo que evita que se separen — si alguien
 * agrega una unidad en un lado y no en el otro, el importador bloquea filas
 * válidas o sugiere unidades que no existen.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { VALID_UNITS, UNIT_ALIASES } from "@/lib/services/epp-import.types"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

describe("catálogo de unidades de medida", () => {
  it("la migración siembra el catálogo (antes producción tenía 1 sola fila)", async () => {
    const units = await inMemoryDb.select().from(schema.productUnits)
    expect(units.length).toBeGreaterThanOrEqual(16)
  })

  it("el catálogo cubre todas las unidades que el importador acepta", async () => {
    const units = await inMemoryDb.select({ code: schema.productUnits.code }).from(schema.productUnits)
    const codes = new Set(units.map((u) => u.code))

    const missing = VALID_UNITS.filter((unit) => !codes.has(unit))
    expect(missing).toEqual([])
  })

  it("todo alias del importador resuelve a un código real del catálogo", async () => {
    const units = await inMemoryDb.select({ code: schema.productUnits.code }).from(schema.productUnits)
    const codes = new Set(units.map((u) => u.code))

    const dangling = Object.entries(UNIT_ALIASES)
      .filter(([, target]) => !codes.has(target))
      .map(([alias, target]) => `${alias} → ${target}`)
    expect(dangling).toEqual([])
  })

  it("las unidades sembradas quedan activas y ordenadas antes que las legacy", async () => {
    const [unidad] = await inMemoryDb.select().from(schema.productUnits)
      .where(eq(schema.productUnits.code, "unidad"))

    expect(unidad?.isActive).toBe(true)
    // 0036 la había dejado en 1001, detrás de todo lo sembrado por 0228.
    expect(unidad?.sortOrder).toBeLessThan(1000)
  })
})
