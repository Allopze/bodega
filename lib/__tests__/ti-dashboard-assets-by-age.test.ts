import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getAssetsByAge } from "@/lib/services/ti/queries"

/**
 * El dashboard de TI caía con Postgres 42803 («column "it_assets.purchase_date"
 * must appear in the GROUP BY clause») porque el CASE del SELECT y el del
 * GROUP BY se escribían dos veces: cada `todayInChile()` emitía su propio
 * placeholder ($1..$3 vs $7..$9), así que para Postgres eran expresiones
 * distintas y el `purchase_date` del SELECT quedaba sin agrupar.
 */
describe("getAssetsByAge", () => {
  const assetTypeId = nanoid()

  beforeAll(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.itAssetTypes)
      .values({ id: assetTypeId, name: "Notebook", category: "computacion", createdAt: now, updatedAt: now })

    // Un activo por tramo, más uno sin fecha y uno dado de baja (excluido).
    const assets: Array<{ purchaseDate: string | null; status?: string }> = [
      { purchaseDate: null },
      { purchaseDate: today(-30) },     // 0-1 año
      { purchaseDate: today(-800) },    // 1-3 años
      { purchaseDate: today(-1500) },   // 3-5 años
      { purchaseDate: today(-3000) },   // 5+ años
      { purchaseDate: today(-30), status: "dado_de_baja" },
    ]
    for (const [i, a] of assets.entries()) {
      await inMemoryDb.insert(schema.itAssets).values({
        id: nanoid(),
        code: `TI-NB-${String(i).padStart(4, "0")}`,
        assetTypeId,
        status: a.status ?? "disponible",
        purchaseDate: a.purchaseDate,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  afterAll(async () => {
    await pg.close()
  })

  it("agrupa el parque vigente por tramo de antigüedad sin fallar en Postgres", async () => {
    const rows = await getAssetsByAge()
    const byTramo = Object.fromEntries(rows.map((r) => [r.tramo, r.total]))

    expect(byTramo).toEqual({
      "sin fecha": 1,
      "0-1 año": 1,
      "1-3 años": 1,
      "3-5 años": 1,
      "5+ años": 1,
    })
  })
})

function today(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}
