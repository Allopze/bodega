import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const mockGetUserIdsWithPermission = vi.hoisted(() => vi.fn())
const mockCreateNotifications = vi.hoisted(() => vi.fn())
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: mockGetUserIdsWithPermission,
}))
vi.mock("@/lib/services/notification-create", () => ({
  createNotifications: mockCreateNotifications,
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { createReport } from "@/lib/services/feedback"
import { runFeedbackSlaReminders } from "@/lib/services/feedback-sla-reminders"

describe("feedback SLA reminders", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetUserIdsWithPermission.mockResolvedValue(["manager-1"])
    mockCreateNotifications.mockResolvedValue(undefined)
    await inMemoryDb.delete(schema.feedbackReports)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.insert(schema.users).values([
      { id: "reporter-1", email: "reporter@test.cl", name: "Reporter", hashedPassword: "hash", isActive: true },
      { id: "manager-1", email: "manager@test.cl", name: "Manager", hashedPassword: "hash", isActive: true },
    ])
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("alerts managers once per day for open tickets near or past their SLA", async () => {
    const dueSoon = await createReport({ tipo: "bug", titulo: "Próximo", descripcion: "SLA pronto" }, "reporter-1")
    const overdue = await createReport({ tipo: "bug", titulo: "Vencido", descripcion: "SLA vencido" }, "reporter-1")
    const resolved = await createReport({ tipo: "bug", titulo: "Cerrado", descripcion: "No avisa" }, "reporter-1")
    await inMemoryDb.update(schema.feedbackReports).set({ dueAt: "2026-08-25T18:00:00.000Z" }).where(eq(schema.feedbackReports.id, dueSoon.id))
    await inMemoryDb.update(schema.feedbackReports).set({ dueAt: "2026-08-24T12:00:00.000Z" }).where(eq(schema.feedbackReports.id, overdue.id))
    await inMemoryDb.update(schema.feedbackReports).set({ estado: "resuelto", dueAt: "2026-08-24T12:00:00.000Z" }).where(eq(schema.feedbackReports.id, resolved.id))

    const result = await runFeedbackSlaReminders(new Date("2026-08-25T12:00:00.000Z"))

    expect(result).toEqual({ examined: 2, dueSoon: 1, overdue: 1, deliveries: 2 })
    expect(mockCreateNotifications).toHaveBeenCalledTimes(2)
    expect(mockCreateNotifications).toHaveBeenCalledWith(["manager-1"], expect.objectContaining({
      type: "feedback_sla_overdue",
      entityId: overdue.id,
      dedupeKey: `feedback-sla:${overdue.id}:overdue:2026-08-25`,
    }))
  })
})
