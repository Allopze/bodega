import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityChecklists, pdtpActivitySchedule, pdtpPrograms, pdtpSheetActivities } from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId, resolveSheetForProgram } from "./helpers"
import { deriveScheduleHorizon, projectRecurrenceToLegacySchedule, type PdtpRecurrenceRule } from "./recurrence"
import { pdtpActivityChecklistId } from "./checklist-domain"

/** Todas las actividades de un programa, ordenadas por N°. Para el tab
 * "Actividades" del builder — no está scoped a una hoja como
 * getPdtpSheetViewByProgram. */
export async function listPdtpProgramActivities(programId: string) {
  return db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId)).orderBy(pdtpActivities.n)
}

export type PdtpObjectiveRenameInput = { programId: string; objectiveOrder: number; objective: string }

/** El objetivo (texto) es compartido por todas las actividades de un mismo
 * `objectiveOrder` (1-8) — no hay tabla `pdtp_objectives` separada. "Editar
 * el objetivo N" es entonces una actualización masiva sobre ese grupo, no
 * un campo de `updatePdtpActivity` (que edita una sola actividad). */
export async function renamePdtpObjective(input: PdtpObjectiveRenameInput, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const now = new Date().toISOString()
  const updated = await db.update(pdtpActivities)
    .set({ objective: input.objective, updatedAt: now })
    .where(and(eq(pdtpActivities.programId, input.programId), eq(pdtpActivities.objectiveOrder, input.objectiveOrder)))
    .returning({ id: pdtpActivities.id })

  if (updated.length > 0) {
    await addPdtpChangeLogEntry(
      input.programId, program.version, userId, `objective:${input.objectiveOrder}`,
      null, { objective: input.objective },
      `Objetivo ${input.objectiveOrder} renombrado (${updated.length} actividad(es) afectadas).`,
    )
  }
  return { updatedCount: updated.length }
}

export type PdtpActivityUpdateInput = {
  activityId: string
  objectiveOrder?: number
  objective?: string
  activity?: string
  program?: string
  notes?: string
  responsibleSlugs?: string[]
  responsibleDisplay?: string
  audienceRoles?: string[]
  scheduleMode?: "scheduled" | "on_demand" | "triggered"
  scheduleClassificationStatus?: "confirmed" | "needs_review"
  recurrenceRule?: PdtpRecurrenceRule | null
  triggerType?: string | null
  triggerDescription?: string | null
  dueDays?: number | null
  evidenceRequirement?: string | null
  indicatorMode?: "planned_vs_completed" | "closed_on_time" | "completed_count" | "not_applicable" | "coverage"
  targetValue?: number | null
  targetUnit?: string | null
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
  audienceRoles?: string[]
  scheduleMode?: "scheduled" | "on_demand" | "triggered"
  scheduleClassificationStatus?: "confirmed" | "needs_review"
  recurrenceRule?: PdtpRecurrenceRule | null
  triggerType?: string | null
  triggerDescription?: string | null
  dueDays?: number | null
  evidenceRequirement?: string | null
  indicatorMode?: "planned_vs_completed" | "closed_on_time" | "completed_count" | "not_applicable" | "coverage"
  targetValue?: number | null
  targetUnit?: string | null
  notes?: string
  sheetCodes: string[]
  schedule?: Array<{ month: number; week: number; plannedQuantity: number }>
}

export type PdtpActivityBatchUpdateInput = {
  programId: string
  activityIds: string[]
  objectiveOrder?: number
  objective?: string
  responsibleSlugs?: string[]
  responsibleDisplay?: string
  evidenceRequirement?: string | null
}

export async function batchUpdatePdtpActivities(input: PdtpActivityBatchUpdateInput, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)
  const uniqueIds = [...new Set(input.activityIds)]
  if (uniqueIds.length === 0) throw new Error("Selecciona al menos una actividad.")
  const activities = await db.select().from(pdtpActivities).where(inArray(pdtpActivities.id, uniqueIds))
  if (activities.length !== uniqueIds.length || activities.some((activity) => activity.programId !== input.programId)) {
    throw new Error("La selección contiene actividades ajenas al programa.")
  }
  if (input.objectiveOrder !== undefined && !input.objective?.trim()) throw new Error("Indica el objetivo de destino.")

  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.objectiveOrder !== undefined) {
    updates.objectiveOrder = input.objectiveOrder
    updates.objective = input.objective!.trim()
  }
  if (input.responsibleSlugs !== undefined) updates.responsibleSlugs = input.responsibleSlugs
  if (input.responsibleDisplay !== undefined) updates.responsibleDisplay = input.responsibleDisplay
  if (input.evidenceRequirement !== undefined) updates.evidenceRequirement = input.evidenceRequirement
  if (Object.keys(updates).length === 1) throw new Error("Selecciona al menos un cambio para aplicar.")

  const changed = await db.update(pdtpActivities).set(updates)
    .where(and(eq(pdtpActivities.programId, input.programId), inArray(pdtpActivities.id, uniqueIds)))
    .returning({ id: pdtpActivities.id })
  await addPdtpChangeLogEntry(
    input.programId,
    program.version,
    userId,
    "activity:batch",
    { activityIds: uniqueIds },
    { activityIds: uniqueIds, ...updates },
    `${changed.length} actividad(es) actualizadas en lote; calendario, vistas y checklist preservados.`,
  )
  return { updatedCount: changed.length }
}

export async function updatePdtpActivity(input: PdtpActivityUpdateInput, userId: string) {
  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const now = new Date().toISOString()
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: now }

  if (input.objectiveOrder !== undefined && input.objectiveOrder !== activity.objectiveOrder) {
    if (!input.objective?.trim()) throw new Error("Indica el objetivo de destino.")
    before.objectiveOrder = activity.objectiveOrder; after.objectiveOrder = input.objectiveOrder
    before.objective = activity.objective; after.objective = input.objective.trim()
    updates.objectiveOrder = input.objectiveOrder
    updates.objective = input.objective.trim()
  } else if (input.objective !== undefined && input.objective !== activity.objective) {
    before.objective = activity.objective; after.objective = input.objective; updates.objective = input.objective
  }

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
  const configurableFields = [
    "audienceRoles", "scheduleMode", "scheduleClassificationStatus", "recurrenceRule", "triggerType", "triggerDescription",
    "dueDays", "evidenceRequirement", "indicatorMode", "targetValue", "targetUnit",
  ] as const
  for (const field of configurableFields) {
    if (input[field] !== undefined && JSON.stringify(input[field]) !== JSON.stringify(activity[field])) {
      before[field] = activity[field]
      after[field] = input[field]
      updates[field] = input[field] as never
    }
  }

  const [updated] = await db.update(pdtpActivities).set(updates).where(eq(pdtpActivities.id, input.activityId)).returning()
  if (!updated) throw new Error("No se pudo actualizar la actividad PDTP.")

  const effectiveSchedule = input.scheduleOverrides !== undefined
    ? input.scheduleOverrides
    : (input.scheduleMode !== undefined || input.recurrenceRule !== undefined)
      ? ((input.scheduleMode ?? activity.scheduleMode) === "scheduled" && (input.recurrenceRule ?? activity.recurrenceRule)
          ? projectRecurrenceToLegacySchedule((input.recurrenceRule ?? activity.recurrenceRule) as PdtpRecurrenceRule, deriveScheduleHorizon(program))
          : [])
      : undefined

  if (effectiveSchedule !== undefined) {
    before.scheduleOverrides = "see after"; after.scheduleOverrides = effectiveSchedule
    // El set entrante es autoritativo para el año del programa: borra
    // celdas existentes que ya no aparecen (semana quitada en la UI) antes
    // de upsertear las que sí. Antes esto solo insertaba/actualizaba y
    // dejaba cantidades planificadas obsoletas en la DB.
    const keptIds = effectiveSchedule.map((cell) => pdtpScheduleId(input.activityId, program.year, cell.month, cell.week))
    await db.delete(pdtpActivitySchedule).where(keptIds.length === 0
      ? and(eq(pdtpActivitySchedule.activityId, input.activityId), eq(pdtpActivitySchedule.year, program.year))
      : and(
          eq(pdtpActivitySchedule.activityId, input.activityId),
          eq(pdtpActivitySchedule.year, program.year),
          notInArray(pdtpActivitySchedule.id, keptIds),
        ))
    for (const cell of effectiveSchedule) {
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
  assertPdtpProgramEditableState(program)

  const existingActivities = await db.select({ n: pdtpActivities.n }).from(pdtpActivities).where(eq(pdtpActivities.programId, input.programId))
  const maxN = existingActivities.reduce((m, row) => Math.max(m, row.n), 0)
  const newN = maxN + 1
  const now = new Date().toISOString()
  const activityId = pdtpActivityId(input.programId, newN)

  const [created] = await db.insert(pdtpActivities).values({
    id: activityId, programId: input.programId, n: newN, objectiveOrder: input.objectiveOrder,
    objective: input.objective, activity: input.activity, program: input.program,
    responsibleSlugs: input.responsibleSlugs, responsibleDisplay: input.responsibleDisplay,
    audienceRoles: input.audienceRoles ?? [], scheduleMode: input.scheduleMode ?? "scheduled",
    scheduleClassificationStatus: input.scheduleClassificationStatus ?? "confirmed",
    recurrenceRule: input.recurrenceRule ?? null, triggerType: input.triggerType ?? null,
    triggerDescription: input.triggerDescription ?? null, dueDays: input.dueDays ?? null,
    evidenceRequirement: input.evidenceRequirement ?? null, indicatorMode: input.indicatorMode ?? "planned_vs_completed",
    targetValue: input.targetValue ?? null, targetUnit: input.targetUnit ?? null,
    sourceSheetRow: 0, notes: input.notes ?? null, createdAt: now, updatedAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo crear la actividad PDTP.")

  const schedule = input.schedule ?? ((input.scheduleMode ?? "scheduled") === "scheduled" && input.recurrenceRule
    ? projectRecurrenceToLegacySchedule(input.recurrenceRule, deriveScheduleHorizon(program))
    : [])
  if (schedule.length > 0) {
    for (const cell of schedule) {
      await db.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, program.year, cell.month, cell.week), activityId,
        year: program.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: "manual",
      })
    }
  }

  for (const sheetCode of input.sheetCodes) {
    const sheet = await resolveSheetForProgram(input.programId, sheetCode)
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
  assertPdtpProgramEditableState(program)

  await db.delete(pdtpActivities).where(eq(pdtpActivities.id, activityId))
  await addPdtpChangeLogEntry(activity.programId, program.version, userId, `activity:${activity.n}`, { n: activity.n, activity: activity.activity }, null, `Actividad ${activity.n} eliminada.`)
}

/** Duplica la definición reusable de una actividad dentro del mismo programa.
 * Conserva calendario, vistas y checklist; nunca copia ejecuciones ni firmas. */
export async function duplicatePdtpActivity(activityId: string, userId: string) {
  const [source] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!source) throw new Error("Actividad PDTP no encontrada.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, source.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    const [{ maxN } = { maxN: 0 }] = await tx.select({ maxN: sql<number>`COALESCE(MAX(${pdtpActivities.n}), 0)` })
      .from(pdtpActivities).where(eq(pdtpActivities.programId, source.programId))
    const n = Number(maxN) + 1
    const id = pdtpActivityId(source.programId, n)
    const [copy] = await tx.insert(pdtpActivities).values({
      id,
      programId: source.programId,
      n,
      objectiveOrder: source.objectiveOrder,
      objective: source.objective,
      activity: `${source.activity} (copia)`,
      program: source.program,
      responsibleSlugs: source.responsibleSlugs,
      responsibleDisplay: source.responsibleDisplay,
      audienceRoles: source.audienceRoles,
      scheduleMode: source.scheduleMode,
      scheduleClassificationStatus: source.scheduleClassificationStatus,
      recurrenceRule: source.recurrenceRule,
      triggerType: source.triggerType,
      triggerDescription: source.triggerDescription,
      dueDays: source.dueDays,
      evidenceRequirement: source.evidenceRequirement,
      indicatorMode: source.indicatorMode,
      targetValue: source.targetValue,
      targetUnit: source.targetUnit,
      sourceSheetRow: 0,
      notes: source.notes,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!copy) throw new Error("No se pudo duplicar la actividad.")

    const [schedules, memberships, checklists] = await Promise.all([
      tx.select().from(pdtpActivitySchedule).where(eq(pdtpActivitySchedule.activityId, source.id)),
      tx.select().from(pdtpSheetActivities).where(eq(pdtpSheetActivities.activityId, source.id)),
      tx.select().from(pdtpActivityChecklists).where(eq(pdtpActivityChecklists.activityId, source.id)),
    ])
    if (schedules.length > 0) await tx.insert(pdtpActivitySchedule).values(schedules.map((cell) => ({
      id: pdtpScheduleId(id, cell.year, cell.month, cell.week),
      activityId: id,
      year: cell.year,
      month: cell.month,
      week: cell.week,
      plannedQuantity: cell.plannedQuantity,
      sourceColumn: cell.sourceColumn,
    })))
    for (const membership of memberships) {
      const [{ maxOrder } = { maxOrder: 0 }] = await tx.select({ maxOrder: sql<number>`COALESCE(MAX(${pdtpSheetActivities.displayOrder}), 0)` })
        .from(pdtpSheetActivities).where(eq(pdtpSheetActivities.sheetId, membership.sheetId))
      const nextOrder = Number(maxOrder) + 1
      await tx.insert(pdtpSheetActivities).values({
        id: pdtpSheetActivityId(source.programId, membership.sheetCode, n),
        sheetId: membership.sheetId,
        sheetCode: membership.sheetCode,
        activityId: id,
        sheetRow: nextOrder,
        displayOrder: nextOrder,
      })
    }
    if (checklists.length > 0) await tx.insert(pdtpActivityChecklists).values(checklists.map((checklist) => ({
      id: pdtpActivityChecklistId(id, checklist.version),
      activityId: id,
      programId: source.programId,
      version: checklist.version,
      label: checklist.label,
      definitionJson: checklist.definitionJson,
      isActive: checklist.isActive,
      createdAt: now,
      updatedAt: now,
    })))
    return copy
  })

  await addPdtpChangeLogEntry(
    source.programId,
    program.version,
    userId,
    `activity:${created.n}`,
    null,
    { sourceActivityId: source.id, n: created.n, activity: created.activity },
    `Actividad ${source.n} duplicada como actividad ${created.n}; sin ejecuciones ni firmas.`,
  )
  return created
}

export async function reorderPdtpActivities(programId: string, orderedIds: string[], userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId))
  const seen = new Set(activities.map((a) => a.id))
  if (orderedIds.length !== seen.size || orderedIds.some((id) => !seen.has(id))) {
    throw new Error("La lista de orden no coincide con las actividades del programa.")
  }

  const now = new Date().toISOString()
  // `n` está bajo unique(programId, n) y check(n >= 1): renumerar en el
  // sitio puede chocar a mitad de camino (ej. swap 1<->2 pone n=1 en dos
  // filas) y un offset negativo violaría el check. Pasada 1 corre todo a
  // un rango alto que ningún programa real alcanza (fuera del unique
  // vigente), pasada 2 fija el n final — ambas en una transacción para que
  // un fallo a mitad no deje el programa parcialmente renumerado.
  const TEMP_N_OFFSET = 1_000_000
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(pdtpActivities)
        .set({ n: TEMP_N_OFFSET + i })
        .where(eq(pdtpActivities.id, orderedIds[i]!))
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(pdtpActivities)
        .set({ n: i + 1, updatedAt: now })
        .where(eq(pdtpActivities.id, orderedIds[i]!))
    }
  })

  await addPdtpChangeLogEntry(programId, program.version, userId, "activity:reorder", null, { orderedIds }, "Actividades reordenadas.")
}
