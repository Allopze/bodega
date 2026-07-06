import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpPrograms, pdtpSheetActivities, pdtpSheets } from "@/db/schema"
import { addPdtpChangeLogEntry, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"

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
    const [sheet] = await db.select().from(pdtpSheets)
      .where(and(
        eq(pdtpSheets.code, sheetCode),
        or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, input.programId)),
      ))
      .limit(1)
    if (!sheet) throw new Error(`Hoja PDTP no encontrada: ${sheetCode}.`)

    const [{ maxOrder } = { maxOrder: 0 }] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${pdtpSheetActivities.displayOrder}), 0)` })
      .from(pdtpSheetActivities)
      .where(eq(pdtpSheetActivities.sheetId, sheet.id))
    const nextOrder = Number(maxOrder) + 1
    await db.insert(pdtpSheetActivities).values({
      id: pdtpSheetActivityId(input.programId, sheetCode, newN), sheetId: sheet.id, sheetCode, activityId,
      sheetRow: nextOrder, displayOrder: nextOrder,
    }).onConflictDoNothing()
  }

  await addPdtpChangeLogEntry(input.programId, program.version, userId, `activity:${newN}`, null, { n: newN, activity: input.activity, sheetCodes: input.sheetCodes }, `Actividad ${newN} agregada manualmente.`)
  return created
}

export async function deletePdtpActivity(activityId: string, userId: string) {
  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden eliminar actividades de programas en estado borrador (draft).")

  await db.delete(pdtpActivities).where(eq(pdtpActivities.id, activityId))
  await addPdtpChangeLogEntry(activity.programId, program.version, userId, `activity:${activity.n}`, { n: activity.n, activity: activity.activity }, null, `Actividad ${activity.n} eliminada.`)
}

export async function reorderPdtpActivities(programId: string, orderedIds: string[], userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden reordenar actividades de programas en estado borrador (draft).")

  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId))
  const seen = new Set(activities.map((a) => a.id))
  if (orderedIds.length !== seen.size || orderedIds.some((id) => !seen.has(id))) {
    throw new Error("La lista de orden no coincide con las actividades del programa.")
  }

  const now = new Date().toISOString()
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(pdtpActivities)
      .set({ n: i + 1, updatedAt: now })
      .where(eq(pdtpActivities.id, orderedIds[i]!))
  }

  await addPdtpChangeLogEntry(programId, program.version, userId, "activity:reorder", null, { orderedIds }, "Actividades reordenadas.")
}
