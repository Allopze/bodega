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
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
})

/**
 * Helper: ejecuta `fn` y devuelve el `message` del error principal y del
 * `cause` concatenado. Vitest's `.toThrow(regex)` no inspecciona `cause`,
 * por eso hacemos match manual.
 */
async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown = null
  try { await promise } catch (e) { thrown = e }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  const msg = `${(thrown as Error).message}\n${cause?.message ?? ""}`
  expect(msg).toMatch(/check|constraint|violates|Failing row/i)
}

describe("PDTP CHECK constraints SQL", () => {
  beforeEach(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "p1", year: 2026, version: 1, status: "active", title: "T",
      elaboratedByName: "X", elaboratedByTitle: "Y",
      createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "a1", programId: "p1", n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
  })

  it("pdtp_executions rechaza status inválido", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e1", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 1,
        executedQuantity: 1, status: "invalid",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions acepta status válidos (sanity)", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "e-ok", activityId: "a1", worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      executedQuantity: 1, status: "submitted",
      evidencePhotos: [], createdAt: now, updatedAt: now,
    })
  })

  it("pdtp_executions rechaza month fuera de 1-12", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e2", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 13, week: 1,
        executedQuantity: 1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions rechaza week fuera de 1-4", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e3", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 5,
        executedQuantity: 1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions rechaza executedQuantity negativa", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e4", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 1,
        executedQuantity: -1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_programs rechaza status inválido", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpPrograms).values({
        id: "p-invalid", year: 2027, version: 1, status: "impossible",
        title: "T", elaboratedByName: "X", elaboratedByTitle: "Y",
        createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_programs rechaza compliance_target fuera de 0-1", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpPrograms).values({
        id: "p-bad-target", year: 2027, version: 1, status: "draft",
        title: "T", elaboratedByName: "X", elaboratedByTitle: "Y",
        complianceTarget: 1.5,
        createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_activities rechaza display_order negativo", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpActivities).values({
        id: "a-bad-order", programId: "p1", n: 1, displayOrder: -1, activity: "A", program: "P",
        responsibleSlugs: [], responsibleDisplay: "R",
        sourceSheetRow: 1, createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_activity_schedule rechaza planned_quantity negativa", async () => {
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpActivitySchedule).values({
        id: "s1", activityId: "a1", year: 2026, month: 1, week: 1,
        plannedQuantity: -1, sourceColumn: "x",
      } as never),
    )
  })
})
