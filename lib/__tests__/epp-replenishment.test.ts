import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

describe("EPP replenishment", () => {
  const now = new Date().toISOString()
  const access = {
    userId: "epp-replenishment-manager",
    scope: { mode: "some" as const, ids: ["ws-epp-replenishment"] },
    permissions: ["prevention:epp:view"],
  }

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.users).values({
      id: access.userId, name: "Gestor EPP", email: "epp-replenishment@local.invalid",
      hashedPassword: "hash", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-epp-replenishment", name: "Faena EPP", code: "EPP-REPL",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-epp-replenishment", rut: "11111111-1", firstName: "Ana", lastName: "Pérez",
      worksiteId: "ws-epp-replenishment", createdAt: now,
    })
    await inMemoryDb.insert(schema.eppTypes).values({
      id: "type-epp-replenishment", code: "test-replenishment", label: "Casco de prueba", createdAt: now,
    })
    await inMemoryDb.insert(schema.preventionEppRequirements).values({
      id: "requirement-epp-replenishment", eppTypeId: "type-epp-replenishment", scopeType: "global",
      enforcement: "blocking", reason: "Protección de cabeza exigida en toda la faena.",
      createdByUserId: access.userId, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  it("is idempotent for a live worker/type coverage gap", async () => {
    const { generateReplenishmentDrafts } = await import("@/lib/services/epp-replenishment")

    const first = await generateReplenishmentDrafts(access)
    const second = await generateReplenishmentDrafts(access)

    expect(first.createdCount).toBe(1)
    expect(second).toEqual({ createdCount: 0, requestCodes: [] })
    const links = await inMemoryDb.select().from(schema.eppReplenishmentLinks)
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
    expect(links).toHaveLength(1)
    expect(items).toHaveLength(1)
    expect(links[0]?.requestItemId).toBe(items[0]?.id)
  })
})
