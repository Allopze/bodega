import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.notifications)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
  })
})

describe("createNotifications — dedup_key", () => {
  it("mismo (userId, dedupeKey) insertado dos veces produce 1 sola fila", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")

    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
      dedupeKey: "pdtp-weekly:user-1:ws-1:2026:1:W1",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(1)
  })

  it("distinto dedupeKey produce filas distintas", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")
    const base = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
    }

    await createNotifications(["user-1"], { ...base, dedupeKey: "k1" })
    await createNotifications(["user-1"], { ...base, dedupeKey: "k2" })
    await createNotifications(["user-1"], { ...base, dedupeKey: "k1" }) // dup de k1

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(2)
  })

  it("sin dedupeKey, sigue creando duplicados (comportamiento legacy)", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")
    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(3)
  })

  it("distinto userId, mismo dedupeKey → filas distintas", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "user-2", name: "U2", email: "u2@test", hashedPassword: "x", isActive: true,
    })
    const { createNotifications } = await import("@/lib/services/notifications")
    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
      dedupeKey: "shared-key",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-2"], input)
    await createNotifications(["user-1"], input) // dup

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(2)
  })
})
