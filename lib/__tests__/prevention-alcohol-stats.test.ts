import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.alcoholTests)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-2",
    name: "Faena B",
    code: "FB",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values([
    { id: "w-1", firstName: "W", lastName: "One", rut: "1-1", worksiteId: "ws-1", isActive: true },
    { id: "w-2", firstName: "W", lastName: "Two", rut: "2-2", worksiteId: "ws-1", isActive: true },
    { id: "w-3", firstName: "W", lastName: "Three", rut: "3-3", worksiteId: "ws-1", isActive: true },
    { id: "w-4", firstName: "W", lastName: "Four", rut: "4-4", worksiteId: "ws-1", isActive: true },
    { id: "w-5", firstName: "W", lastName: "Five", rut: "5-5", worksiteId: "ws-1", isActive: true },
  ])
})

describe("alcohol test stats & random suggestion (Feature C)", () => {
  it("calcula totales y tasa de positivos global y por faena", async () => {
    const { registerAlcoholTest, getAlcoholTestStats } = await import("@/lib/services/prevention-alcohol-tests")

    await registerAlcoholTest({ worksiteId: "ws-1", testedWorkerId: "w-1", shift: "dia", result: "positivo" }, "user-1", ["ws-1"])
    await registerAlcoholTest({ worksiteId: "ws-1", testedWorkerId: "w-2", shift: "dia", result: "negativo" }, "user-1", ["ws-1"])
    await registerAlcoholTest({ worksiteId: "ws-1", testedWorkerId: "w-3", shift: "dia", result: "negativo" }, "user-1", ["ws-1"])

    const stats = await getAlcoholTestStats(["ws-1"])
    expect(stats.total).toBe(3)
    expect(stats.positive).toBe(1)
    expect(stats.negative).toBe(2)
    expect(stats.positiveRate).toBeCloseTo(1 / 3, 5)
    expect(stats.byWorksite.find((w) => w.worksiteId === "ws-1")!.positive).toBe(1)
  })

  it("positiveRate es null cuando no hay tests", async () => {
    const { getAlcoholTestStats } = await import("@/lib/services/prevention-alcohol-tests")
    const stats = await getAlcoholTestStats(["ws-1"])
    expect(stats.total).toBe(0)
    expect(stats.positiveRate).toBeNull()
  })

  it("sugiere hasta N trabajadores activos de la faena y respeta el scope", async () => {
    const { suggestRandomWorkersForTest } = await import("@/lib/services/prevention-alcohol-tests")
    const picked = await suggestRandomWorkersForTest("ws-1", ["ws-1"], 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked.map((p) => p.id)).size).toBe(3) // sin repetidos
    await expect(suggestRandomWorkersForTest("ws-2", ["ws-1"], 3)).rejects.toThrow(/sin acceso/i)
  })
})
