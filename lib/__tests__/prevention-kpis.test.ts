import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with the app DB shape in tests.
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
  await inMemoryDb.delete(schema.laborHours)
  await inMemoryDb.delete(schema.preventionIncidentActions)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "Prevencionista", email: "prev@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena A", code: "FA", isActive: true },
    { id: "ws-2", name: "Faena B", code: "FB", isActive: true },
  ])
})

describe("prevention kpis service (P3.20)", () => {
  it("registers labor hours (upsert by worksite+period) and denies out-of-scope access", async () => {
    const { setLaborHours, listLaborHours } = await import("@/lib/services/prevention-kpis")

    await setLaborHours({ worksiteId: "ws-1", period: "2026-01", hours: 1000 }, ["ws-1"])
    await setLaborHours({ worksiteId: "ws-1", period: "2026-01", hours: 1200 }, ["ws-1"])

    const rows = await listLaborHours("ws-1", ["ws-1"])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.hours).toBe(1200)

    await expect(setLaborHours({ worksiteId: "ws-2", period: "2026-01", hours: 500 }, ["ws-1"])).rejects.toThrow(/sin acceso/i)
  })

  it("computes the real frequency rate (IF) from accident-type incidents and labor hours", async () => {
    const { setLaborHours, getIncidentFrequencyRate } = await import("@/lib/services/prevention-kpis")

    await setLaborHours({ worksiteId: "ws-1", period: "2026-01", hours: 500_000 }, ["ws-1"])
    await setLaborHours({ worksiteId: "ws-1", period: "2026-02", hours: 500_000 }, ["ws-1"])

    await inMemoryDb.insert(schema.preventionIncidents).values([
      {
        id: "inc-1", worksiteId: "ws-1", type: "accidente", status: "closed", severity: "leve",
        occurredAt: "2026-01-15T10:00:00.000Z", title: "Caída", description: "Caída de altura",
        createdBy: "user-1", createdAt: "2026-01-15T10:00:00.000Z", updatedAt: "2026-01-15T10:00:00.000Z",
      },
      {
        id: "inc-2", worksiteId: "ws-1", type: "incidente", status: "closed", severity: "leve",
        occurredAt: "2026-01-16T10:00:00.000Z", title: "Cuasi", description: "No cuenta como accidente",
        createdBy: "user-1", createdAt: "2026-01-16T10:00:00.000Z", updatedAt: "2026-01-16T10:00:00.000Z",
      },
    ])

    const rate = await getIncidentFrequencyRate("ws-1", 2026, ["ws-1"])
    expect(rate.accidentCount).toBe(1)
    expect(rate.totalHours).toBe(1_000_000)
    expect(rate.frequencyRate).toBe(1)
  })

  it("returns a null frequency rate when no labor hours are registered yet", async () => {
    const { getIncidentFrequencyRate } = await import("@/lib/services/prevention-kpis")
    const rate = await getIncidentFrequencyRate("ws-1", 2026, ["ws-1"])
    expect(rate.totalHours).toBe(0)
    expect(rate.frequencyRate).toBeNull()
  })
})
