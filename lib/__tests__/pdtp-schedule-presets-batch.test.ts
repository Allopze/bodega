import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
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

// Mock parcial de `./helpers`: en todos los tests se comporta exactamente
// como el módulo real (delega en `actual`), salvo cuando el test de
// rollback activa `poisonedActivityId` — ahí `pdtpScheduleId` lanza para esa
// actividad puntual, simulando una falla real (no un conflicto conocido) a
// mitad de un lote, sin tocar ninguna otra pieza del módulo.
const poison = vi.hoisted(() => ({ activityId: null as string | null }))
vi.mock("@/lib/services/pdtp/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/pdtp/helpers")>()
  return {
    ...actual,
    pdtpScheduleId: (activityId: string, year: number, month: number, week: number) => {
      if (poison.activityId && activityId === poison.activityId) {
        throw new Error("Fallo simulado en la escritura del calendario")
      }
      return actual.pdtpScheduleId(activityId, year, month, week)
    },
  }
})

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  poison.activityId = null
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
})

/** Programa borrador; sin período declarado su horizonte es el año completo. */
async function createDraftProgram(year: number) {
  const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
  return createLegacyPdtpProgramForTests({ year, title: `Programa ${year}`, userId: "user-1" })
}

/** Actividad "scheduled" sin regla ni celdas — lista para que el lote la tome. */
async function addScheduledActivity(programId: string, overrides: Partial<{
  scheduleMode: "scheduled" | "on_demand" | "triggered"
}> = {}) {
  const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  return addPdtpActivity({
    programId,
    activity: "Actividad de prueba",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: overrides.scheduleMode ?? "scheduled",
  }, "user-1")
}

async function scheduleCellsOf(activityId: string, year: number) {
  return inMemoryDb.select().from(schema.pdtpActivitySchedule)
    .where(and(eq(schema.pdtpActivitySchedule.activityId, activityId), eq(schema.pdtpActivitySchedule.year, year)))
}

describe("PDTP: aplicación masiva de presets de planificación", () => {
  it("aplica un preset con regla a 3 actividades y deja recurrenceRule coherente", async () => {
    const { applyPdtpSchedulePresetToActivities, presetToCells, presetToRule } = await import("@/lib/services/prevention-pdtp")
    const { deriveScheduleHorizon, scheduleCellsFingerprint } = await import("@/lib/services/pdtp/recurrence")
    const program = await createDraftProgram(2081)
    const a1 = await addScheduledActivity(program.id)
    const a2 = await addScheduledActivity(program.id)
    const a3 = await addScheduledActivity(program.id)

    const result = await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [a1.id, a2.id, a3.id],
      preset: "biweekly_13",
      params: {},
      mode: "replace",
    }, "user-1")

    expect(result.skippedConflicts).toEqual([])
    expect(new Set(result.applied)).toEqual(new Set([a1.id, a2.id, a3.id]))

    const horizon = deriveScheduleHorizon(program)
    const expectedRule = presetToRule("biweekly_13", {})
    const expectedCells = presetToCells("biweekly_13", {}, horizon)
    const expectedFingerprint = scheduleCellsFingerprint(expectedCells)

    for (const activityId of [a1.id, a2.id, a3.id]) {
      const [row] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activityId))
      expect(row?.recurrenceRule).toEqual(expectedRule)
      const cells = await scheduleCellsOf(activityId, program.year)
      expect(scheduleCellsFingerprint(cells.map((c) => ({ month: c.month, week: c.week, plannedQuantity: Number(c.plannedQuantity) })))).toBe(expectedFingerprint)
    }
  })

  it("una actividad con celdas manuales entra en skippedConflicts sin replaceConfirmed, y se aplica con él", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2082)
    const activity = await addScheduledActivity(program.id)
    // Planificación manual: sin recurrenceRule, con una celda puesta a mano.
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `${activity.id}-s-${program.year}-01-1`,
      activityId: activity.id, year: program.year, month: 1, week: 1, plannedQuantity: 3, sourceColumn: "manual",
    })

    const rejected = await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [activity.id],
      preset: "weekly",
      params: {},
      mode: "replace",
    }, "user-1")
    expect(rejected.applied).toEqual([])
    expect(rejected.skippedConflicts).toEqual([{ activityId: activity.id, n: activity.n, reason: "manual_schedule_would_be_replaced" }])

    // La celda manual sigue intacta: no se tocó nada.
    const untouched = await scheduleCellsOf(activity.id, program.year)
    expect(untouched).toHaveLength(1)
    expect(Number(untouched[0]!.plannedQuantity)).toBe(3)

    const confirmed = await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [activity.id],
      preset: "weekly",
      params: {},
      mode: "replace",
      replaceConfirmed: true,
    }, "user-1")
    expect(confirmed.applied).toEqual([activity.id])
    expect(confirmed.skippedConflicts).toEqual([])

    const [row] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activity.id))
    expect(row?.recurrenceRule).toEqual({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 })
  })

  it("fill_empty sólo toca actividades sin calendario, no las ya planificadas", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2083)
    const withSchedule = await addScheduledActivity(program.id)
    const empty = await addScheduledActivity(program.id)
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `${withSchedule.id}-s-${program.year}-03-2`,
      activityId: withSchedule.id, year: program.year, month: 3, week: 2, plannedQuantity: 1, sourceColumn: "manual",
    })

    const result = await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [withSchedule.id, empty.id],
      preset: "monthly_week",
      params: { weekOfMonth: 2 },
      mode: "fill_empty",
    }, "user-1")

    expect(result.applied).toEqual([empty.id])
    expect(result.skippedConflicts).toEqual([])

    const untouched = await scheduleCellsOf(withSchedule.id, program.year)
    expect(untouched).toHaveLength(1)
    expect(untouched[0]?.month).toBe(3)
    expect(untouched[0]?.week).toBe(2)

    const filled = await scheduleCellsOf(empty.id, program.year)
    expect(filled.length).toBeGreaterThan(0)
    expect(filled.every((cell) => cell.week === 2)).toBe(true)
  })

  it("retiradas y con scheduleMode distinto de scheduled no se tocan", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2084)
    const onDemand = await addScheduledActivity(program.id, { scheduleMode: "on_demand" })
    const toRetire = await addScheduledActivity(program.id)
    await inMemoryDb.update(schema.pdtpActivities).set({
      status: "retired",
      retiredReason: "Actividad discontinuada por cambio de proceso",
      retiredEffectiveFrom: `${program.year}-01-01`,
      retiredAt: new Date().toISOString(),
    }).where(eq(schema.pdtpActivities.id, toRetire.id))

    const result = await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [onDemand.id, toRetire.id],
      preset: "weekly",
      params: {},
      mode: "replace",
    }, "user-1")

    expect(result.applied).toEqual([])
    expect(result.skippedConflicts).toEqual(expect.arrayContaining([
      { activityId: onDemand.id, n: onDemand.n, reason: "not_scheduled_mode" },
      { activityId: toRetire.id, n: toRetire.n, reason: "retired" },
    ]))
    expect(result.skippedConflicts).toHaveLength(2)
  })

  it("el horizonte sale del período del programa, no del año calendario", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2085)
    await inMemoryDb.update(schema.pdtpPrograms).set({
      periodStart: `${program.year}-03-01`,
      periodEnd: `${program.year}-06-30`,
    }).where(eq(schema.pdtpPrograms.id, program.id))
    const activity = await addScheduledActivity(program.id)

    // "campaign" pide todo el año (ene-dic) pero el período del programa
    // sólo cubre marzo-junio: las celdas no deben salirse de ese rango.
    await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [activity.id],
      preset: "campaign",
      params: { monthFrom: 1, monthTo: 12 },
      mode: "replace",
    }, "user-1")

    const cells = await scheduleCellsOf(activity.id, program.year)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell.month >= 3 && cell.month <= 6)).toBe(true)
  })

  it("un programa que ya entró a revisión rechaza el lote", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2086)
    const activity = await addScheduledActivity(program.id)
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "in_review" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [activity.id],
      preset: "weekly",
      params: {},
      mode: "replace",
    }, "user-1")).rejects.toThrow(/revisión/i)
  })

  it("registra una sola entrada de changelog (schedule:batch) para todo el lote", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2087)
    const a1 = await addScheduledActivity(program.id)
    const a2 = await addScheduledActivity(program.id)

    await applyPdtpSchedulePresetToActivities({
      programId: program.id,
      activityIds: [a1.id, a2.id],
      preset: "daily",
      params: { plannedQuantity: 5 },
      mode: "replace",
    }, "user-1")

    const entries = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(and(eq(schema.pdtpChangeLog.programId, program.id), eq(schema.pdtpChangeLog.section, "schedule:batch")))
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    const after = entry.after as { activities: Array<{ activityId: string; n: number }> }
    expect(after.activities.map((a) => a.activityId).sort()).toEqual([a1.id, a2.id].sort())
    const before = entry.before as { activities: Array<{ activityId: string; recurrenceRule: unknown }> }
    expect(before.activities).toHaveLength(2)
  })

  it("una falla real a mitad del lote no deja ninguna actividad modificada", async () => {
    const { applyPdtpSchedulePresetToActivities } = await import("@/lib/services/prevention-pdtp")
    const program = await createDraftProgram(2088)
    const a = await addScheduledActivity(program.id)
    const b = await addScheduledActivity(program.id) // se "envenena": su escritura de celdas lanzará
    const c = await addScheduledActivity(program.id)

    poison.activityId = b.id
    try {
      await expect(applyPdtpSchedulePresetToActivities({
        programId: program.id,
        activityIds: [a.id, b.id, c.id],
        preset: "weekly",
        params: {},
        mode: "replace",
      }, "user-1")).rejects.toThrow("Fallo simulado en la escritura del calendario")
    } finally {
      poison.activityId = null
    }

    for (const activityId of [a.id, b.id, c.id]) {
      const cells = await scheduleCellsOf(activityId, program.year)
      expect(cells).toHaveLength(0)
      const [row] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activityId))
      expect(row?.recurrenceRule).toBeNull()
    }
    const entries = await inMemoryDb.select().from(schema.pdtpChangeLog)
      .where(and(eq(schema.pdtpChangeLog.programId, program.id), eq(schema.pdtpChangeLog.section, "schedule:batch")))
    expect(entries).toHaveLength(0)
  })
})
