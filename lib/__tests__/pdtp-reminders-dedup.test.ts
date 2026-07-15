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
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
  })
})

describe("findPdtpWeeklyPending", () => {
  it("uses only the current effective cell and excludes inactive worksites", async () => {
    const now = "2026-07-01T00:00:00.000Z"
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-active", name: "Faena activa", code: "ACT", isActive: true },
      { id: "ws-inactive", name: "Faena histórica", code: "OLD", isActive: false },
    ])
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "program-2026", year: 2026, version: 1, status: "active", title: "PDTP 2026",
      elaboratedByName: "Prevención", elaboratedByTitle: "PR", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values([
      { id: "act-pending", programId: "program-2026", n: 1, objectiveOrder: 1, objective: "O", activity: "Pendiente", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 1, createdAt: now, updatedAt: now },
      { id: "act-executed", programId: "program-2026", n: 2, objectiveOrder: 1, objective: "O", activity: "Ejecutada", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 2, createdAt: now, updatedAt: now },
      { id: "act-overridden", programId: "program-2026", n: 3, objectiveOrder: 1, objective: "O", activity: "Override cero", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 3, createdAt: now, updatedAt: now },
      { id: "act-prior-week", programId: "program-2026", n: 4, objectiveOrder: 1, objective: "O", activity: "Semana anterior", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 4, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: "schedule-pending", activityId: "act-pending", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-executed", activityId: "act-executed", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-overridden", activityId: "act-overridden", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-prior-week", activityId: "act-prior-week", year: 2026, month: 7, week: 1, plannedQuantity: 1, sourceColumn: "xlsx" },
    ])
    await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
      id: "override-zero", activityId: "act-overridden", worksiteId: "ws-active", year: 2026, month: 7, week: 2,
      plannedQuantity: 0, updatedByUserId: "user-1", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "execution-current", activityId: "act-executed", worksiteId: "ws-active", year: 2026, month: 7, week: 2,
      executedQuantity: 1, status: "submitted", evidencePhotos: [], createdAt: now, updatedAt: now,
    })

    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })

    expect(targets).toEqual([
      { worksiteId: "ws-active", worksiteName: "Faena activa", activityIds: ["act-pending"] },
    ])
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
