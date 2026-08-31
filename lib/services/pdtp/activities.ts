import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityChecklists, pdtpActivitySchedule, pdtpPrograms, pdtpSheetActivities } from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, pdtpActivityId, pdtpScheduleId, pdtpSheetActivityId, resolveSheetForProgram } from "./helpers"
import {
  derivePdtpScheduleSource,
  deriveScheduleHorizon,
  diffScheduleCells,
  projectRecurrenceToLegacySchedule,
  recurrenceRulesEqual,
  scheduleCellsFingerprint,
  type PdtpRecurrenceRule,
  type PdtpScheduleCell,
  type PdtpScheduleHorizon,
  type PdtpScheduleSource,
} from "./recurrence"
import { pdtpActivityChecklistId } from "./checklist-domain"

/** Todas las actividades de un programa, ordenadas por N°. Para el tab
 * "Actividades" del builder — no está scoped a una hoja como
 * getPdtpSheetViewByProgram. */
export async function listPdtpProgramActivities(programId: string) {
  return db.select().from(pdtpActivities)
    .where(eq(pdtpActivities.programId, programId))
    .orderBy(pdtpActivities.displayOrder, pdtpActivities.n)
}

/**
 * Celdas de planificación de un conjunto de actividades **acotadas a un año**.
 *
 * El filtro de año no es cosmético: `pdtpActivitySchedule` es única por
 * (actividad, año, mes, semana), pero las vistas que la editan indexan por
 * `mes-semana` — sin acotar el año, una celda de otro año se pinta como si
 * fuera del año en curso y al guardar se escribe en él, fabricando cantidad
 * planificada que nadie planificó (y que es el denominador del indicador de
 * cumplimiento). El borrado autoritativo de `updatePdtpActivity` también está
 * acotado al año del programa, así que ambos lados tienen que coincidir.
 */
export type PdtpScheduleConflictDetail = {
  reason: "manual_schedule_would_be_replaced" | "schedule_changed_elsewhere"
  scheduleSource: PdtpScheduleSource
  currentCellCount: number
  nextCellCount: number
  removedCellCount: number
  currentPlannedTotal: number
  nextPlannedTotal: number
}

/**
 * La escritura se detuvo para no destruir planificación en silencio.
 *
 * No es un fallo inesperado: es la respuesta esperada a una operación que
 * habría borrado cantidad planificada que nadie pidió borrar. El llamador debe
 * mostrar el detalle y, si el usuario lo confirma, reintentar con
 * `scheduleReplaceConfirmed`.
 */
export class PdtpScheduleConflictError extends Error {
  constructor(readonly detail: PdtpScheduleConflictDetail) {
    super(detail.reason === "schedule_changed_elsewhere"
      ? "La planificación de esta actividad cambió en otra sesión. Recarga antes de guardar."
      : `Esta actividad tiene ${detail.currentCellCount} semana(s) ajustadas manualmente. Guardar la recurrencia las reemplaza y la cantidad planificada pasaría de ${detail.currentPlannedTotal} a ${detail.nextPlannedTotal}. Confirma el reemplazo para continuar.`)
    this.name = "PdtpScheduleConflictError"
  }
}

/**
 * Qué celdas debe quedar escritas y de dónde salen.
 *
 * La condición es **que el modo o la regla hayan cambiado de verdad**, no que
 * vengan en el input. Antes bastaba con que `recurrenceRule` estuviera
 * presente, y el diálogo de edición la manda siempre: editar el texto de una
 * actividad re-proyectaba la recurrencia y borraba su planificación manual.
 */
function resolveScheduleWrite({ input, activity, horizon }: {
  input: PdtpActivityUpdateInput
  activity: typeof pdtpActivities.$inferSelect
  horizon: PdtpScheduleHorizon
}): { cells: PdtpScheduleCell[] | undefined; origin: "manual_matrix" | "rule_projection" | "none" } {
  if (input.scheduleOverrides !== undefined) {
    const cells = input.scheduleOverrides.map((cell) => ({
      month: Number(cell.month), week: Number(cell.week), plannedQuantity: Number(cell.plannedQuantity),
    }))
    return { cells, origin: "manual_matrix" }
  }

  const modeChanged = input.scheduleMode !== undefined && input.scheduleMode !== activity.scheduleMode
  const ruleChanged = input.recurrenceRule !== undefined
    && !recurrenceRulesEqual(input.recurrenceRule, activity.recurrenceRule as PdtpRecurrenceRule | null)
  if (!modeChanged && !ruleChanged) return { cells: undefined, origin: "none" }

  const nextMode = input.scheduleMode ?? activity.scheduleMode
  const nextRule = (input.recurrenceRule !== undefined ? input.recurrenceRule : activity.recurrenceRule) as PdtpRecurrenceRule | null
  return {
    cells: nextMode === "scheduled" && nextRule ? projectRecurrenceToLegacySchedule(nextRule, horizon) : [],
    origin: "rule_projection",
  }
}

export async function listPdtpProgramScheduleForYear(activityIds: string[], year: number) {
  if (activityIds.length === 0) return []
  return db.select().from(pdtpActivitySchedule)
    .where(and(inArray(pdtpActivitySchedule.activityId, activityIds), eq(pdtpActivitySchedule.year, year)))
}

export type PdtpActivityUpdateInput = {
  activityId: string
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
  /** Autoriza reemplazar una planificación ajustada a mano por la proyección de
   *  la recurrencia. Sin esto, esa reescritura se rechaza (ver
   *  `PdtpScheduleConflictError`). */
  scheduleReplaceConfirmed?: boolean
  /** Huella de las celdas que el cliente creía vigentes. Si no coincide con la
   *  que hay en la base, otra sesión editó la planificación entremedio y la
   *  escritura se rechaza en vez de pisarla. */
  expectedScheduleFingerprint?: string | null
}

export type PdtpActivityAddInput = {
  programId: string
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
  if (activities.some((activity) => activity.status === "retired")) {
    throw new Error("Las actividades retiradas no admiten cambios.")
  }
  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.responsibleSlugs !== undefined) updates.responsibleSlugs = input.responsibleSlugs
  if (input.responsibleDisplay !== undefined) updates.responsibleDisplay = input.responsibleDisplay
  if (input.evidenceRequirement !== undefined) updates.evidenceRequirement = input.evidenceRequirement
  if (Object.keys(updates).length === 1) throw new Error("Selecciona al menos un cambio para aplicar.")

  // Cambio + changelog en la misma transacción: `pdtp_change_log` es el control
  // de cambios del documento que firman los aprobadores, y sin esto un lote
  // podía aplicarse sin quedar registrado.
  const changed = await db.transaction(async (tx) => {
    const rows = await tx.update(pdtpActivities).set(updates)
      .where(and(eq(pdtpActivities.programId, input.programId), inArray(pdtpActivities.id, uniqueIds)))
      .returning({ id: pdtpActivities.id })
    await addPdtpChangeLogEntry(
      input.programId,
      program.version,
      userId,
      "activity:batch",
      { activityIds: uniqueIds },
      { activityIds: uniqueIds, ...updates },
      `${rows.length} actividad(es) actualizadas en lote; calendario, vistas y checklist preservados.`,
      tx,
    )
    return rows
  })
  return { updatedCount: changed.length }
}

export async function updatePdtpActivity(input: PdtpActivityUpdateInput, userId: string) {
  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  if (activity.status === "retired") throw new Error("Una actividad retirada no admite cambios.")

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

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
  const configurableFields = [
    "audienceRoles", "scheduleMode", "scheduleClassificationStatus", "recurrenceRule", "triggerType", "triggerDescription",
    "dueDays", "evidenceRequirement", "indicatorMode", "targetValue", "targetUnit",
  ] as const
  for (const field of configurableFields) {
    if (input[field] === undefined) continue
    // `recurrenceRule` vive en jsonb: comparar su serialización da falsos
    // cambios por orden de claves (ver recurrenceRulesEqual).
    const unchanged = field === "recurrenceRule"
      ? recurrenceRulesEqual(input.recurrenceRule, activity.recurrenceRule as PdtpRecurrenceRule | null)
      : JSON.stringify(input[field]) === JSON.stringify(activity[field])
    if (unchanged) continue
    before[field] = activity[field]
    after[field] = input[field]
    updates[field] = input[field] as never
  }

  const horizon = deriveScheduleHorizon(program)
  const { cells: effectiveSchedule, origin: scheduleWriteOrigin } = resolveScheduleWrite({ input, activity, horizon })

  // Actividad + calendario + changelog en una sola transacción. El borrado de
  // celdas obsoletas es autoritativo, así que si commiteaba y los inserts
  // fallaban después quedaba la actividad con un calendario TRUNCADO —pérdida
  // silenciosa de cantidad planificada, que es el denominador del indicador—
  // y sin entrada de changelog que lo dejara trazado.
  return db.transaction(async (tx) => {
    // Bloquea la fila antes de leer el calendario: la comprobación de "esto
    // borraría trabajo manual" no vale nada si otra transacción puede cambiar
    // las celdas entre la lectura y la escritura. Mismo patrón que
    // retirePdtpActivity.
    await tx.select({ id: pdtpActivities.id }).from(pdtpActivities)
      .where(eq(pdtpActivities.id, input.activityId)).for("update")

    const currentCells = (await tx.select().from(pdtpActivitySchedule).where(and(
      eq(pdtpActivitySchedule.activityId, input.activityId),
      eq(pdtpActivitySchedule.year, program.year),
    ))).map((row) => ({ month: row.month, week: row.week, plannedQuantity: Number(row.plannedQuantity) }))
    const currentSource = derivePdtpScheduleSource({
      cells: currentCells,
      scheduleMode: activity.scheduleMode as "scheduled" | "on_demand" | "triggered",
      recurrenceRule: activity.recurrenceRule as PdtpRecurrenceRule | null,
      horizon,
    })

    if (input.expectedScheduleFingerprint != null
      && input.expectedScheduleFingerprint !== scheduleCellsFingerprint(currentCells)) {
      throw new PdtpScheduleConflictError({
        reason: "schedule_changed_elsewhere",
        scheduleSource: currentSource,
        currentCellCount: currentCells.length,
        nextCellCount: effectiveSchedule?.length ?? currentCells.length,
        removedCellCount: 0,
        currentPlannedTotal: currentCells.reduce((sum, cell) => sum + cell.plannedQuantity, 0),
        nextPlannedTotal: (effectiveSchedule ?? currentCells).reduce((sum, cell) => sum + cell.plannedQuantity, 0),
      })
    }

    const scheduleDiff = effectiveSchedule === undefined ? null : diffScheduleCells(currentCells, effectiveSchedule)
    if (scheduleDiff && scheduleWriteOrigin === "rule_projection" && currentSource !== "rule"
      && !input.scheduleReplaceConfirmed) {
      // La proyección de la recurrencia solo puede pisar una planificación que
      // ella misma generó. Si las celdas vigentes no coinciden con la regla
      // guardada, alguien las ajustó a mano y hace falta un sí explícito.
      const destructive = scheduleDiff.removedCells.length > 0
        || scheduleDiff.changedCells.some((cell) => cell.to < cell.from)
      if (destructive) {
        throw new PdtpScheduleConflictError({
          reason: "manual_schedule_would_be_replaced",
          scheduleSource: currentSource,
          currentCellCount: currentCells.length,
          nextCellCount: effectiveSchedule!.length,
          removedCellCount: scheduleDiff.removedCells.length,
          currentPlannedTotal: scheduleDiff.currentPlannedTotal,
          nextPlannedTotal: scheduleDiff.nextPlannedTotal,
        })
      }
    }

    const [updated] = await tx.update(pdtpActivities).set(updates).where(eq(pdtpActivities.id, input.activityId)).returning()
    if (!updated) throw new Error("No se pudo actualizar la actividad PDTP.")

    if (effectiveSchedule !== undefined && scheduleDiff) {
      // El estado previo se registra de verdad: con "see after" el changelog
      // que firman los aprobadores no podía responder qué planificación se
      // perdió.
      before.schedule = currentCells
      after.schedule = effectiveSchedule
      after.scheduleWriteOrigin = scheduleWriteOrigin
      after.scheduleSourceBefore = currentSource
      after.scheduleRemovedCellCount = scheduleDiff.removedCells.length
      after.schedulePlannedTotal = { from: scheduleDiff.currentPlannedTotal, to: scheduleDiff.nextPlannedTotal }
      if (input.scheduleReplaceConfirmed) after.scheduleReplaceConfirmed = true
      // El set entrante es autoritativo para el año del programa: borra
      // celdas existentes que ya no aparecen (semana quitada en la UI) antes
      // de upsertear las que sí. Antes esto solo insertaba/actualizaba y
      // dejaba cantidades planificadas obsoletas en la DB.
      const keptIds = effectiveSchedule.map((cell) => pdtpScheduleId(input.activityId, program.year, cell.month, cell.week))
      await tx.delete(pdtpActivitySchedule).where(keptIds.length === 0
        ? and(eq(pdtpActivitySchedule.activityId, input.activityId), eq(pdtpActivitySchedule.year, program.year))
        : and(
            eq(pdtpActivitySchedule.activityId, input.activityId),
            eq(pdtpActivitySchedule.year, program.year),
            notInArray(pdtpActivitySchedule.id, keptIds),
          ))
      for (const cell of effectiveSchedule) {
        await tx.insert(pdtpActivitySchedule).values({
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
      const note = scheduleDiff
        ? `Actividad ${activity.n} actualizada; planificación ${scheduleDiff.currentPlannedTotal} → ${scheduleDiff.nextPlannedTotal} (${currentCells.length} → ${effectiveSchedule!.length} celda(s)).`
        : `Actividad ${activity.n} actualizada.`
      await addPdtpChangeLogEntry(activity.programId, program.version, userId, `activity:${activity.n}`, before, after, note, tx)
    }
    return updated
  })
}

export async function addPdtpActivity(input: PdtpActivityAddInput, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const existingActivities = await db.select({ n: pdtpActivities.n, displayOrder: pdtpActivities.displayOrder })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, input.programId))
  const maxN = existingActivities.reduce((m, row) => Math.max(m, row.n), 0)
  const maxDisplayOrder = existingActivities.reduce((m, row) => Math.max(m, row.displayOrder), 0)
  const newN = Math.max(90, maxN + 1)
  const now = new Date().toISOString()
  const activityId = pdtpActivityId(input.programId, newN)

  // Las hojas se resuelven ANTES de escribir nada: al validarlas dentro del
  // bucle final, un `sheetCode` inexistente lanzaba con la actividad y su
  // calendario ya commiteados, dejando una actividad sin membresía —invisible
  // en la vista donde el usuario la pidió— y sin entrada de changelog.
  const sheets = await Promise.all(input.sheetCodes.map(async (sheetCode) => {
    const sheet = await resolveSheetForProgram(input.programId, sheetCode)
    if (!sheet) throw new Error(`Hoja PDTP no encontrada: ${sheetCode}.`)
    return { sheetCode, sheet }
  }))

  const schedule = input.schedule ?? ((input.scheduleMode ?? "scheduled") === "scheduled" && input.recurrenceRule
    ? projectRecurrenceToLegacySchedule(input.recurrenceRule, deriveScheduleHorizon(program))
    : [])

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(pdtpActivities).values({
      id: activityId, programId: input.programId, n: newN, displayOrder: maxDisplayOrder + 1,
      activity: input.activity, program: input.program,
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

    for (const cell of schedule) {
      await tx.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, program.year, cell.month, cell.week), activityId,
        year: program.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: "manual",
      })
    }

    for (const { sheetCode, sheet } of sheets) {
      const [{ maxOrder } = { maxOrder: 0 }] = await tx
        .select({ maxOrder: sql<number>`COALESCE(MAX(${pdtpSheetActivities.displayOrder}), 0)` })
        .from(pdtpSheetActivities)
        .where(eq(pdtpSheetActivities.sheetId, sheet.id))
      const nextOrder = Number(maxOrder) + 1
      await tx.insert(pdtpSheetActivities).values({
        id: pdtpSheetActivityId(input.programId, sheetCode, newN), sheetId: sheet.id, sheetCode, activityId,
        sheetRow: nextOrder, displayOrder: nextOrder,
      }).onConflictDoNothing()
    }

    await addPdtpChangeLogEntry(input.programId, program.version, userId, `activity:${newN}`, null, { n: newN, activity: input.activity, sheetCodes: input.sheetCodes }, `Actividad ${newN} agregada manualmente.`, tx)
    return created
  })
}

export async function retirePdtpActivity(input: {
  activityId: string
  reason: string
  effectiveFrom: string
}, userId: string) {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Indica un motivo de retiro de al menos 10 caracteres.")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error("La fecha efectiva de retiro no es válida.")

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpActivities} WHERE id = ${input.activityId} FOR UPDATE`)
    const [activity] = await tx.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada.")
    if (activity.status === "retired") return activity

    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)
    if (input.effectiveFrom < (program.periodStart ?? `${program.year}-01-01`) || input.effectiveFrom > (program.periodEnd ?? `${program.year}-12-31`)) {
      throw new Error("La fecha efectiva debe estar dentro del período del programa.")
    }

    const now = new Date().toISOString()
    const [retired] = await tx.update(pdtpActivities).set({
      status: "retired",
      retiredReason: reason,
      retiredEffectiveFrom: input.effectiveFrom,
      retiredByUserId: userId,
      retiredAt: now,
      updatedAt: now,
    }).where(eq(pdtpActivities.id, input.activityId)).returning()
    if (!retired) throw new Error("No se pudo retirar la actividad.")
    await addPdtpChangeLogEntry(
      activity.programId,
      program.version,
      userId,
      `activity:${activity.n}`,
      { status: activity.status },
      { status: "retired", reason, effectiveFrom: input.effectiveFrom, retiredAt: now, retiredByUserId: userId },
      `Actividad ${activity.n} retirada desde ${input.effectiveFrom}. Motivo: ${reason}`,
      tx,
    )
    return retired
  })
}

/** Duplica la definición reusable de una actividad dentro del mismo programa.
 * Conserva calendario, vistas y checklist; nunca copia ejecuciones ni firmas. */
export async function duplicatePdtpActivity(activityId: string, userId: string) {
  const [source] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!source) throw new Error("Actividad PDTP no encontrada.")
  if (source.status === "retired") throw new Error("No se puede duplicar una actividad retirada.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, source.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const now = new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    const [{ maxN, maxDisplayOrder } = { maxN: 0, maxDisplayOrder: 0 }] = await tx.select({
      maxN: sql<number>`COALESCE(MAX(${pdtpActivities.n}), 0)`,
      maxDisplayOrder: sql<number>`COALESCE(MAX(${pdtpActivities.displayOrder}), 0)`,
    })
      .from(pdtpActivities).where(eq(pdtpActivities.programId, source.programId))
    const n = Math.max(90, Number(maxN) + 1)
    const id = pdtpActivityId(source.programId, n)
    const [copy] = await tx.insert(pdtpActivities).values({
      id,
      programId: source.programId,
      n,
      displayOrder: Number(maxDisplayOrder) + 1,
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
    // Dentro de la misma tx que la copia: si el changelog fallaba después del
    // commit, la actividad duplicada existía sin quedar registrada en el
    // control de cambios del programa.
    await addPdtpChangeLogEntry(
      source.programId,
      program.version,
      userId,
      `activity:${copy.n}`,
      null,
      { sourceActivityId: source.id, n: copy.n, activity: copy.activity },
      `Actividad ${source.n} duplicada como actividad ${copy.n}; sin ejecuciones ni firmas.`,
      tx,
    )
    return copy
  })

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
  // El número de actividad es una identidad histórica y nunca cambia. El
  // orden visual vive en `displayOrder`, así los huecos 4 y 8 y cualquier
  // retiro futuro permanecen trazables.
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(pdtpActivities)
        .set({ displayOrder: i + 1, updatedAt: now })
        .where(eq(pdtpActivities.id, orderedIds[i]!))
    }
    await addPdtpChangeLogEntry(programId, program.version, userId, "activity:reorder", null, { orderedIds }, "Actividades reordenadas.", tx)
  })
}
