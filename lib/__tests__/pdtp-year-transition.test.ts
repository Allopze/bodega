/**
 * lib/__tests__/pdtp-year-transition.test.ts
 *
 * PREV-C03.5 (tanda T5, cambio de año): un hecho de enero del año nuevo, con el
 * programa del año anterior todavía activo y el nuevo en borrador, no puede
 * perderse ni imputarse al año anterior. Queda esperando (libro en `error` con
 * la marca `[no-active-program]`) y se acredita al activar su programa, aunque
 * sean más de 50 hechos. El cierre de una inspección en enero no se revierte.
 *
 * PREV-C03.6: con el año formalmente cerrado, un hecho tardío queda rechazado
 * con su motivo y visible, sin tumbar el cierre de la inspección.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  recordPdtpFulfillmentEvent,
  reconcilePdtpFulfillmentEvents,
  drainPdtpFulfillmentEvents,
  NO_ACTIVE_PROGRAM_LAST_ERROR_TAG,
} = await import("@/lib/services/pdtp/fulfillment")
const { countPdtpFulfillmentBacklog } = await import("@/lib/services/pdtp/backlog")
const { onInspectionCompleted } = await import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")

const OLD_YEAR = 2071
const NEW_YEAR = 2072
const USER_ID = "user-transition"
const WS_ID = "ws-transition"
const ACT_N = 42

function programId(year: number) {
  return `pdtp-${year}-v1`
}

function activityId(year: number) {
  return `${programId(year)}-a-042`
}

async function seedProgram(year: number, status: "draft" | "active" | "closed") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: programId(year), version: 1, year, title: `PDTP ${year}`,
    status, appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto",
    creationMode: "blank", activatedAt: status === "draft" ? null : `${year}-01-01T12:00:00.000Z`,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: activityId(year), programId: programId(year), n: ACT_N,
    activity: "Inspección de extintores", program: "Prevención",
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "triggered", scheduleClassificationStatus: "confirmed",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpTriggerEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevencionista", email: "transition@test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena transición", code: "FT", isActive: true })
})

async function recordJanuaryEvent(sourceId: string, year = NEW_YEAR) {
  return recordPdtpFulfillmentEvent({
    sourceType: "campana", sourceId, worksiteId: WS_ID,
    activityNumbers: [ACT_N], occurredAt: `${year}-01-15T15:00:00.000Z`,
  })
}

async function eventBySource(sourceId: string) {
  const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    .where(eq(schema.pdtpFulfillmentEvents.sourceId, sourceId))
  return event
}

describe("PREV-C03.5 — un hecho de enero espera al programa de su año", () => {
  it("queda en error con la marca [no-active-program] y se acredita en el año nuevo al activarlo", async () => {
    await seedProgram(OLD_YEAR, "active")
    await seedProgram(NEW_YEAR, "draft")

    expect(await recordJanuaryEvent("campana-enero")).toBeNull()
    const waiting = await eventBySource("campana-enero")
    expect(waiting?.status).toBe("error")
    expect(waiting?.lastError?.startsWith(NO_ACTIVE_PROGRAM_LAST_ERROR_TAG)).toBe(true)
    // Nada se imputó al año anterior.
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: `${NEW_YEAR}-01-20T12:00:00.000Z` })
      .where(eq(schema.pdtpPrograms.id, programId(NEW_YEAR)))
    const summary = await reconcilePdtpFulfillmentEvents()
    expect(summary).toMatchObject({ accredited: 1 })
    expect((await eventBySource("campana-enero"))?.status).toBe("accredited")
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(execution).toMatchObject({ activityId: activityId(NEW_YEAR), year: NEW_YEAR, month: 1 })
  })

  it("el panel del año anterior no cuenta los hechos que esperan al año nuevo", async () => {
    await seedProgram(OLD_YEAR, "active")
    await seedProgram(NEW_YEAR, "draft")
    await recordJanuaryEvent("campana-enero-panel")

    const oldBacklog = await countPdtpFulfillmentBacklog(programId(OLD_YEAR))
    expect(oldBacklog.errored).toBe(0)
    expect(oldBacklog.erroredWaitingOnActivation).toBe(0)

    const newBacklog = await countPdtpFulfillmentBacklog(programId(NEW_YEAR))
    expect(newBacklog.errored).toBe(1)
    expect(newBacklog.erroredWaitingOnActivation).toBe(1)
  })

  it("al activar se vacía el libro aunque haya más de 50 hechos, y no se atasca en los que siguen esperando", async () => {
    await seedProgram(OLD_YEAR, "active")
    await seedProgram(NEW_YEAR, "draft")
    // 55 hechos de un año todavía sin programa ocupan los primeros lugares del
    // orden por antigüedad: un lote de 50 fijo los reintentaría para siempre.
    for (let i = 0; i < 55; i++) await recordJanuaryEvent(`futuro-${i}`, NEW_YEAR + 1)
    for (let i = 0; i < 60; i++) await recordJanuaryEvent(`enero-${i}`)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: `${NEW_YEAR}-01-20T12:00:00.000Z` })
      .where(eq(schema.pdtpPrograms.id, programId(NEW_YEAR)))
    const summary = await drainPdtpFulfillmentEvents({ batchSize: 50 })
    expect(summary.accredited).toBe(60)
    expect(summary.processed).toBe(115)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(60)
    expect(new Set(executions.map((row) => row.year))).toEqual(new Set([NEW_YEAR]))
    expect((await eventBySource("futuro-0"))?.status).toBe("error")
  })
})

describe("PREV-C03.5 — cerrar una inspección en enero no falla", () => {
  it("con el año anterior activo y el nuevo en borrador, el cierre queda y el hecho espera en el libro", async () => {
    await seedProgram(OLD_YEAR, "active")
    await seedProgram(NEW_YEAR, "draft")

    await expect(inMemoryDb.transaction((tx) => onInspectionCompleted({
      runId: "run-enero",
      worksiteId: WS_ID,
      completedAt: `${NEW_YEAR}-01-08T14:00:00.000Z`,
      completedByUserId: USER_ID,
      activityNumbers: [ACT_N],
    }, tx as never))).resolves.toBeUndefined()

    const event = await eventBySource("run-enero")
    expect(event?.status).toBe("pending")
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })
})

describe("PREV-C03.6 — un hecho tardío de un año cerrado", () => {
  it("se rechaza con su motivo, visible en el libro, sin revertir el cierre de la inspección", async () => {
    await seedProgram(OLD_YEAR, "closed")
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ yearClosedAt: `${NEW_YEAR}-01-25T12:00:00.000Z`, yearCloseReason: "Cierre anual de prueba" })
      .where(eq(schema.pdtpPrograms.id, programId(OLD_YEAR)))
    await seedProgram(NEW_YEAR, "active")

    await expect(inMemoryDb.transaction((tx) => onInspectionCompleted({
      runId: "run-tardio",
      worksiteId: WS_ID,
      completedAt: `${OLD_YEAR}-12-20T14:00:00.000Z`,
      completedByUserId: USER_ID,
      activityNumbers: [ACT_N],
    }, tx as never))).resolves.toBeUndefined()

    const event = await eventBySource("run-tardio")
    expect(event?.status).toBe("rejected")
    expect((event?.resultJson as { skippedYearClosed?: unknown }).skippedYearClosed).toBeTruthy()
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)

    const backlog = await countPdtpFulfillmentBacklog(programId(OLD_YEAR))
    expect(backlog.rejected).toBe(1)
    expect(backlog.recentRejected[0]?.reason).toMatch(/cerrado formalmente/)
  })
})
