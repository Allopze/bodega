import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime; sólo difiere el HKT del driver.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getCopecSyncStartOptions, setCopecSyncStartDate } = await import("@/lib/combustibles/copec-sync")

describe("persistencia inicial del cursor Copec", () => {
  it("inserta el primer estado sin castear una versión vacía a timestamptz", async () => {
    const before = await getCopecSyncStartOptions()

    await expect(setCopecSyncStartDate(before.currentStart, before.currentStart)).resolves.toMatchObject({
      currentStart: before.currentStart,
    })

    const row = await inMemoryDb.query.systemSettings.findFirst({
      where: eq(schema.systemSettings.key, "combustibles.copec.sync"),
    })
    expect(row).toBeDefined()
    expect(JSON.parse(row!.value)).toMatchObject({ cursor: before.currentStart })
  })
})
