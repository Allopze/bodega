import { eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpPrograms, pdtpSheetActivities } from "@/db/schema"
import { addPdtpChangeLogEntry, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"

export type PdtpActivityUpdateInput = {
  activityId: string
  activity?: string
  program?: string
  notes?: string
  responsibleSlugs?: string[]
  responsibleDisplay?: string
  scheduleOverrides?: Array<{ month: number; week: number; plannedQuantity: number }>
}

export type PdtpActivityAddInput = {
  programId: string
  objectiveOrder: number
  objective: string
  activity: string
  program: string
  responsibleSlugs: string[]
  responsibleDisplay: string
  notes?: string
  sheetCodes: string[]
  schedule?: Array<{ month: number; week: number; plannedQuantity: number }>
}

export async function updatePdtpActivity(input: PdtpActivityUpdateInput, userId: string) {
  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden editar actividades de programas en estado borrador (draft).")

  const now = new Date().toISOString()
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: now }

  if (input.activity !== undefined && input.activity !== activity.activity) {
    before.activity = activity.activity; after.activity = input.activity; updates.activity = input.activity
  }
  if (input.program !== undefined && input.program !== activity.program) {
    before.program = activity.program; after.program = input.program; updates.program = input.program
  }
  if (input.notes !== undefined && input.notes !== activity.notes) {
    before.notes = activity.notes; after.notes = input.notes; updates.notes = input.notes
  }
  if (input.responsibleSlugs !== undefined) {
    before.responsibleSlugs = activity.responsibleSlugs; after.responsibleSlugs = input.responsibleSlugs
    updates.responsibleSlugs = input.responsibleSlugs
  }
  if (input.responsibleDisplay !== undefined && input.responsibleDisplay !== activity.responsibleDisplay) {
    before.responsibleDisplay = activity.responsibleDisplay; after.responsibleDisplay = input.responsibleDisplay
    updates.responsibleDisplay = input.responsibleDisplay
  }

  const [updated] = await db.update(pdtpActivities).set(updates).where(eq(pdtpActivities.id, input.activityId)).returning()
  if (!updated) throw new Error("No se pudo actualizar la actividad PDTP.")

  if (input.scheduleOverrides && input.scheduleOverrides.length > 0) {
    before.scheduleOverrides = "see after"; after.scheduleOverrides = input.scheduleOverrides
    for (const cell of input.scheduleOverrides) {
      await db.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(input.activityId, program.year, cell.month, cell.week),
        activityId: input.activityId, year: program.year, month: cell.month, week: cell.week,
        plannedQuantity: cell.plannedQuantity, sourceColumn: "manual",
      }).onConflictDoUpdate({
        target: [pdtpActivitySchedule.activityId, pdtpActivitySchedule.year, pdtpActivitySchedule.month, pdtpActivitySchedule.week],
        set: { plannedQuantity: cell.plannedQuantity, sourceColumn: "manual" },
      })
    }
  }

  if (Object.keys(after).length > 0) {
    await addPdtpChangeLogEntry(activity.programId, program.version, userId, `activity:${activity.n}`, before, after, `Actividad ${activity.n} actualizada.`)
  }
  return updated
}

export async function addPdtpActivity(input: PdtpActivityAddInput, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden agregar actividades a programas en estado borrador (draft).")

  const existingActivities = await db.select({ n: pdtpActivities.n }).from(pdtpActivities).where(eq(pdtpActivities.programId, input.programId))
  const maxN = existingActivities.reduce((m, row) => Math.max(m, row.n), 0)
  const newN = maxN + 1
  const now = new Date().toISOString()
  const activityId = pdtpActivityId(input.programId, newN)

  const [created] = await db.insert(pdtpActivities).values({
    id: activityId, programId: input.programId, n: newN, objectiveOrder: input.objectiveOrder,
    objective: input.objective, activity: input.activity, program: input.program,
    responsibleSlugs: input.responsibleSlugs, responsibleDisplay: input.responsibleDisplay,
    sourceSheetRow: 0, notes: input.notes ?? null, createdAt: now, updatedAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo crear la actividad PDTP.")

  if (input.schedule && input.schedule.length > 0) {
    for (const cell of input.schedule) {
      await db.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, program.year, cell.month, cell.week), activityId,
        year: program.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: "manual",
      })
    }
  }

  for (const sheetCode of input.sheetCodes) {
    await db.insert(pdtpSheetActivities).values({
      id: pdtpSheetActivityId(input.programId, sheetCode, newN), sheetCode, activityId, sheetRow: 0, displayOrder: newN,
    }).onConflictDoNothing()
  }

  await addPdtpChangeLogEntry(input.programId, program.version, userId, `activity:${newN}`, null, { n: newN, activity: input.activity, sheetCodes: input.sheetCodes }, `Actividad ${newN} agregada manualmente.`)
  return created
}
