import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime.
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
  await inMemoryDb.delete(schema.preventionEmergencyDrills)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "emergency-list-user",
    name: "Responsable Emergencias",
    email: "emergency-list@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-emergency-list", name: "Faena Emergencias", code: "EM-LIST", isActive: true },
    { id: "ws-emergency-list-two", name: "Faena Emergencias Dos", code: "EM-LIST-2", isActive: true },
    { id: "ws-emergency-outside", name: "Faena fuera de alcance", code: "EM-OUT", isActive: true },
  ])
  await inMemoryDb.insert(schema.preventionEmergencyPlans).values([
    plan("approved", { status: "approved", approvedByUserId: "emergency-list-user", approvedAt: "2026-08-01T10:00:00.000Z" }),
    plan("draft", { worksiteId: "ws-emergency-list-two", status: "draft" }),
    plan("outside", { worksiteId: "ws-emergency-outside", status: "approved", approvedByUserId: "emergency-list-user", approvedAt: "2026-08-01T10:00:00.000Z" }),
  ])
  await inMemoryDb.insert(schema.preventionEmergencyDrills).values([
    drill("completed", { status: "completed", executedAt: "2026-08-02T10:00:00.000Z", outcome: "satisfactory" }),
    drill("needs-improvement", { planId: "emergency-list-draft", worksiteId: "ws-emergency-list-two", status: "completed", executedAt: "2026-08-03T10:00:00.000Z", outcome: "needs_improvement" }),
    drill("outside", { planId: "emergency-list-outside", worksiteId: "ws-emergency-outside", status: "completed", executedAt: "2026-08-04T10:00:00.000Z", outcome: "needs_improvement" }),
  ])
})

const VIEWER = {
  userId: "emergency-list-user",
  scope: { mode: "some", ids: ["ws-emergency-list", "ws-emergency-list-two"] } as WorksiteScope,
  permissions: ["prevention:emergency:view"],
}

function plan(id: string, overrides: Partial<typeof schema.preventionEmergencyPlans.$inferInsert> = {}) {
  return {
    id: `emergency-list-${id}`,
    worksiteId: "ws-emergency-list",
    code: `EM-LIST-${id}`,
    title: `Plan de emergencia ${id}`,
    status: "draft",
    createdByUserId: "emergency-list-user",
    ...overrides,
  }
}

function drill(id: string, overrides: Partial<typeof schema.preventionEmergencyDrills.$inferInsert> = {}) {
  return {
    id: `emergency-list-${id}`,
    planId: "emergency-list-approved",
    worksiteId: "ws-emergency-list",
    scenarioType: "incendio",
    scheduledFor: "2026-08-01T10:00:00.000Z",
    status: "scheduled",
    createdByUserId: "emergency-list-user",
    ...overrides,
  }
}

describe("emergency list quick filters — persistence", () => {
  it("filters the whole scoped dataset and derives KPI counts before pagination", async () => {
    const { getEmergencyDashboardCounts, listEmergencyDrills, listEmergencyPlansPage } = await import("@/lib/services/prevention-emergency")

    const [approvedPlans, improvementDrills, counts] = await Promise.all([
      listEmergencyPlansPage(VIEWER, { quickFilter: "approved", limit: 1, offset: 0 }),
      listEmergencyDrills(VIEWER, { quickFilter: "needs_improvement" }),
      getEmergencyDashboardCounts(VIEWER),
    ])

    expect(approvedPlans).toMatchObject({ total: 1, limit: 1, offset: 0 })
    expect(approvedPlans.rows.map((row) => row.plan.id)).toEqual(["emergency-list-approved"])
    expect(improvementDrills.map((row) => row.drill.id)).toEqual(["emergency-list-needs-improvement"])
    expect(counts).toEqual({
      totalPlans: 2,
      approvedPlans: 1,
      draftPlans: 1,
      totalDrills: 2,
      completedDrills: 2,
      needsImprovementDrills: 1,
    })
  })
})
