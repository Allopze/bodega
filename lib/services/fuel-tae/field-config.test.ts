import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { suggestSupplyMedium } from "@/lib/combustibles/field-load-media"
import { SUPPLY_MEDIUM_CHANNEL_LABELS } from "@/lib/combustibles/source-labels"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { buildFieldLoadConfig } = await import("./access")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelTaeLoadingPoints).values([
    { id: "lp-cfg-tae", worksiteId: IDS.wsA, name: "Surtidor TAE bodega", type: "tae" },
    { id: "lp-cfg-tct", worksiteId: IDS.wsA, name: "Estación TCT Ruta 5", type: "card_station" },
    { id: "lp-cfg-cmpc", worksiteId: IDS.wsA, name: "Surtidor CMPC", type: "fixed_dispenser" },
  ])
}, 120_000)

/**
 * El formulario de terreno muestra el nombre de pantalla del medio («Vasija (carga Copec)») pero
 * el lugar de carga se nombra con la sigla que escribió la gente («Surtidor TAE bodega»).
 * La sugerencia no puede depender del texto que se ve: se rompía cada vez que se renombraba.
 */
describe("buildFieldLoadConfig · medio sugerido por el lugar de carga", () => {
  it("el medio TAE se muestra como la vasija y aun así se preselecciona en su lugar de carga", async () => {
    const config = await buildFieldLoadConfig(IDS.wsA, "lp-cfg-tae")
    const tae = config.supplyMedia.find((medium) => medium.id === IDS.mediumTae)
    expect(tae?.name).toBe(SUPPLY_MEDIUM_CHANNEL_LABELS.TAE)
    expect(suggestSupplyMedium(config.loadingPoint?.name, config.supplyMedia)).toBe(IDS.mediumTae)
  })

  it("el medio TCT y uno con nombre propio también se preseleccionan por la sigla del lugar", async () => {
    const tct = await buildFieldLoadConfig(IDS.wsA, "lp-cfg-tct")
    expect(suggestSupplyMedium(tct.loadingPoint?.name, tct.supplyMedia)).toBe(IDS.mediumTct)
    const cmpc = await buildFieldLoadConfig(IDS.wsA, "lp-cfg-cmpc")
    expect(suggestSupplyMedium(cmpc.loadingPoint?.name, cmpc.supplyMedia)).toBe(IDS.mediumCmpc)
  })
})
