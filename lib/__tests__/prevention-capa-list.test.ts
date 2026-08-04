/**
 * The CAPA list quick filters are part of the server query, not a visual-only
 * client filter: totals and pagination must describe the same bounded dataset.
 */
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
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "capa-list-user",
    name: "Responsable CAPA",
    email: "capa-list@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-capa-list", name: "Faena CAPA", code: "CAPA-LIST", isActive: true },
    { id: "ws-capa-outside", name: "Faena fuera de alcance", code: "CAPA-OUT", isActive: true },
  ])

  await inMemoryDb.insert(schema.preventionCapaActions).values([
    capa("open", { createdAt: "2026-08-01T08:00:00.000Z" }),
    capa("overdue-stop", {
      createdAt: "2026-08-02T08:00:00.000Z",
      status: "in_progress",
      targetDate: "2020-01-01",
      reconciliationStatus: "needs_assignment",
      requiresImmediateStop: true,
    }),
    capa("pending-verification", {
      createdAt: "2026-08-03T08:00:00.000Z",
      status: "pending_verification",
    }),
    capa("closed-stop", {
      createdAt: "2026-08-04T08:00:00.000Z",
      status: "closed",
      requiresImmediateStop: true,
    }),
    capa("verified", {
      createdAt: "2026-08-05T08:00:00.000Z",
      status: "verified",
      targetDate: "2020-01-01",
    }),
    capa("outside", {
      createdAt: "2026-08-06T08:00:00.000Z",
      worksiteId: "ws-capa-outside",
      requiresImmediateStop: true,
    }),
  ])
})

const VIEWER = {
  scope: { mode: "some", ids: ["ws-capa-list"] } as WorksiteScope,
  permissions: ["prevention:capa:view"],
}

function capa(id: string, overrides: Partial<typeof schema.preventionCapaActions.$inferInsert> = {}) {
  const createdAt = overrides.createdAt ?? "2026-08-01T08:00:00.000Z"
  return {
    id: `capa-list-${id}`,
    code: `CAPA-LIST-${id}`,
    sourceType: "manual" as const,
    sourceId: `source-${id}`,
    worksiteId: "ws-capa-list",
    finding: `Hallazgo ${id}`,
    actionDescription: `Acción correctiva ${id}`,
    targetDate: "2099-12-31",
    createdByUserId: "capa-list-user",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

describe("CAPA list quick filters — persistence", () => {
  it("filters and counts the scoped server result before applying pagination", async () => {
    const { getCapaDashboardCounts, listCapaActionsPage } = await import("@/lib/services/prevention-capa")

    const [open, overdue, pendingVerification, unreconciled, immediateStop, counts] = await Promise.all([
      listCapaActionsPage({ ...VIEWER, quickFilter: "open", limit: 2, offset: 1 }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "overdue" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "pending_verification" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "unreconciled" }),
      listCapaActionsPage({ ...VIEWER, quickFilter: "immediate_stop" }),
      getCapaDashboardCounts(VIEWER),
    ])

    expect(open).toMatchObject({ total: 4, limit: 2, offset: 1 })
    expect(open.rows.map((row) => row.id)).toEqual([
      "capa-list-pending-verification", "capa-list-overdue-stop",
    ])
    expect(overdue.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(pendingVerification.rows.map((row) => row.id)).toEqual(["capa-list-pending-verification"])
    expect(unreconciled.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(immediateStop.rows.map((row) => row.id)).toEqual(["capa-list-overdue-stop"])
    expect(counts).toEqual({
      open: 4,
      overdue: 1,
      pendingVerification: 1,
      unreconciled: 1,
      immediateStop: 1,
    })
  })
})
