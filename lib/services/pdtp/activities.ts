import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpActivities, pdtpActivityChecklists, pdtpActivitySchedule, pdtpCatalogActivities, pdtpCatalogActivityRevisions, pdtpObjectives, pdtpPrograms, pdtpSheetActivities, workerCapabilities } from "@/db/schema"
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
  type PdtpScheduleDiff,
  type PdtpScheduleHorizon,
  type PdtpScheduleSource,
} from "./recurrence"
import { pdtpActivityChecklistId } from "./checklist-domain"
import type { PdtpSubjectSource } from "./subject-registry"
import { WORKER_CAPABILITY_CODE_PATTERN } from "@/lib/services/worker-positions/normalization"

function normalizedSubjectCapabilityCodes(codes: readonly string[] | null | undefined): string[] | null {
  if (codes == null) return null
  return [...new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean))].sort()
}

async function validateCapabilitySubjectConfiguration(
  source: string | null,
  codes: readonly string[] | null,
): Promise<void> {
  if (source !== "trabajadores_capacidad") {
    if (codes?.length) throw new Error("Las capacidades sólo corresponden a la fuente de trabajadores por capacidad.")
    return
  }
  if (!codes?.length) throw new Error("Selecciona al menos una capacidad para construir el padrón.")
  if (codes.some((code) => !WORKER_CAPABILITY_CODE_PATTERN.test(code))) {
    throw new Error("La configuración contiene un código de capacidad inválido.")
  }
  const existing = await db.select({ code: workerCapabilities.code }).from(workerCapabilities)
    .where(and(inArray(workerCapabilities.code, [...codes]), eq(workerCapabilities.isActive, true)))
  if (existing.length !== codes.length) {
    throw new Error("Una o más capacidades del padrón no existen o están inactivas.")
  }
}

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

export type PdtpScheduleWriteResult = {
  /** Celdas vigentes ANTES de esta escritura (para construir el `before` del changelog del llamador). */
  currentCells: PdtpScheduleCell[]
  /** De dónde salía la planificación vigente antes de escribir. */
  currentSource: PdtpScheduleSource
  /** `null` si `cells` venía `undefined` (el llamador no pidió cambiar el calendario). */
  scheduleDiff: PdtpScheduleDiff | null
}

/**
 * Núcleo transaccional de toda escritura del calendario de una actividad:
 * bloquea la fila (`SELECT … FOR UPDATE`), lee las celdas vigentes del año,
 * valida `expectedFingerprint` contra ellas (huella obsoleta ⇒
 * `schedule_changed_elsewhere`), protege una planificación manual de ser
 * reemplazada por una proyección sin confirmación explícita
 * (`manual_schedule_would_be_replaced`) y, si nada de eso rechaza la
 * escritura, reemplaza las celdas del año por `cells` (borra las que sobran,
 * upsertea las nuevas).
 *
 * Extraído de `updatePdtpActivity` (Tarea 2.3) para que la aplicación masiva
 * de presets (`schedule-batch.ts`) reutilice exactamente la misma lógica de
 * conflicto por actividad en vez de reimplementarla. El único cambio de
 * orden respecto al código original es que aquí la escritura de celdas
 * ocurre en una sola llamada (antes: los chequeos corrían antes de
 * `tx.update(pdtpActivities)` y el borrado/upsert de celdas después); ambas
 * partes están dentro de la misma transacción, así que un throw en cualquier
 * punto revierte todo por igual — el orden relativo no cambia qué queda
 * commiteado ni qué error se lanza. `updatePdtpActivity` mantiene su
 * secuencia observable idéntica: mismos chequeos, mismas condiciones, mismos
 * `PdtpScheduleConflictError`.
 *
 * `guardAgainstManualOverwrite` reemplaza la condición original
 * `scheduleWriteOrigin === "rule_projection"`: `updatePdtpActivity` la pasa
 * ya calculada así (comportamiento idéntico bit a bit). El aplicador masivo
 * (`applyPdtpSchedulePresetToActivities`) la fija siempre en `true`, incluso
 * para el preset `punctual` sin regla — decisión de esa tarea, no heredada de
 * aquí: ver el comentario en `schedule-batch.ts`.
 */
export async function writePdtpActivitySchedule(tx: Tx, params: {
  activityId: string
  programYear: number
  horizon: PdtpScheduleHorizon
  /** Modo y regla vigentes ANTES de esta escritura (para derivar `currentSource`). */
  currentScheduleMode: "scheduled" | "on_demand" | "triggered"
  currentRecurrenceRule: PdtpRecurrenceRule | null
  /** `undefined` = no tocar el calendario (mismo significado que `effectiveSchedule` en `resolveScheduleWrite`). */
  cells: PdtpScheduleCell[] | undefined
  guardAgainstManualOverwrite: boolean
  replaceConfirmed: boolean
  expectedFingerprint?: string | null
}): Promise<PdtpScheduleWriteResult> {
  const { activityId, programYear, horizon, currentScheduleMode, currentRecurrenceRule, cells, guardAgainstManualOverwrite, replaceConfirmed, expectedFingerprint } = params

  // Bloquea la fila antes de leer el calendario: la comprobación de "esto
  // borraría trabajo manual" no vale nada si otra transacción puede cambiar
  // las celdas entre la lectura y la escritura. Mismo patrón que
  // retirePdtpActivity.
  await tx.select({ id: pdtpActivities.id }).from(pdtpActivities)
    .where(eq(pdtpActivities.id, activityId)).for("update")

  const currentCells = (await tx.select().from(pdtpActivitySchedule).where(and(
    eq(pdtpActivitySchedule.activityId, activityId),
    eq(pdtpActivitySchedule.year, programYear),
  ))).map((row) => ({ month: row.month, week: row.week, plannedQuantity: Number(row.plannedQuantity) }))
  const currentSource = derivePdtpScheduleSource({
    cells: currentCells,
    scheduleMode: currentScheduleMode,
    recurrenceRule: currentRecurrenceRule,
    horizon,
  })

  if (expectedFingerprint != null && expectedFingerprint !== scheduleCellsFingerprint(currentCells)) {
    throw new PdtpScheduleConflictError({
      reason: "schedule_changed_elsewhere",
      scheduleSource: currentSource,
      currentCellCount: currentCells.length,
      nextCellCount: cells?.length ?? currentCells.length,
      removedCellCount: 0,
      currentPlannedTotal: currentCells.reduce((sum, cell) => sum + cell.plannedQuantity, 0),
      nextPlannedTotal: (cells ?? currentCells).reduce((sum, cell) => sum + cell.plannedQuantity, 0),
    })
  }

  const scheduleDiff = cells === undefined ? null : diffScheduleCells(currentCells, cells)
  if (scheduleDiff && guardAgainstManualOverwrite && currentSource !== "rule" && !replaceConfirmed) {
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
        nextCellCount: cells!.length,
        removedCellCount: scheduleDiff.removedCells.length,
        currentPlannedTotal: scheduleDiff.currentPlannedTotal,
        nextPlannedTotal: scheduleDiff.nextPlannedTotal,
      })
    }
  }

  if (cells !== undefined && scheduleDiff) {
    // El set entrante es autoritativo para el año del programa: borra
    // celdas existentes que ya no aparecen (semana quitada en la UI) antes
    // de upsertear las que sí. Antes esto solo insertaba/actualizaba y
    // dejaba cantidades planificadas obsoletas en la DB.
    const keptIds = cells.map((cell) => pdtpScheduleId(activityId, programYear, cell.month, cell.week))
    await tx.delete(pdtpActivitySchedule).where(keptIds.length === 0
      ? and(eq(pdtpActivitySchedule.activityId, activityId), eq(pdtpActivitySchedule.year, programYear))
      : and(
          eq(pdtpActivitySchedule.activityId, activityId),
          eq(pdtpActivitySchedule.year, programYear),
          notInArray(pdtpActivitySchedule.id, keptIds),
        ))
    for (const cell of cells) {
      await tx.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, programYear, cell.month, cell.week),
        activityId, year: programYear, month: cell.month, week: cell.week,
        plannedQuantity: cell.plannedQuantity, sourceColumn: "manual",
      }).onConflictDoUpdate({
        target: [pdtpActivitySchedule.activityId, pdtpActivitySchedule.year, pdtpActivitySchedule.month, pdtpActivitySchedule.week],
        set: { plannedQuantity: cell.plannedQuantity, sourceColumn: "manual" },
      })
    }
  }

  return { currentCells, currentSource, scheduleDiff }
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
  /** Objetivo del programa (RE-36) al que responde la actividad; `null` desasigna. */
  objectiveId?: string | null
  audienceRoles?: string[]
  scheduleMode?: "scheduled" | "on_demand" | "triggered"
  scheduleClassificationStatus?: "confirmed" | "needs_review"
  recurrenceRule?: PdtpRecurrenceRule | null
  triggerType?: string | null
  triggerDescription?: string | null
  dueDays?: number | null
  dueHours?: number | null
  evidenceRequirement?: string | null
  indicatorMode?: "planned_vs_completed" | "closed_on_time" | "completed_count" | "not_applicable" | "coverage"
  /** De qué registro sale el padrón; sólo tiene sentido con `coverage`. */
  subjectSource?: PdtpSubjectSource | null
  /** Capacidades combinadas como OR cuando la fuente es
   * `trabajadores_capacidad`. */
  subjectCapabilityCodes?: string[] | null
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
  catalogActivityId?: string
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
  dueHours?: number | null
  evidenceRequirement?: string | null
  indicatorMode?: "planned_vs_completed" | "closed_on_time" | "completed_count" | "not_applicable" | "coverage"
  /** De qué registro sale el padrón; sólo tiene sentido con `coverage`. */
  subjectSource?: PdtpSubjectSource | null
  subjectCapabilityCodes?: string[] | null
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
  /** Objetivo del programa (RE-36) a asignar a las N actividades; `null` desasigna. */
  objectiveId?: string | null
}

/** El objetivo, si viene definido, debe pertenecer al mismo programa que la actividad (FK compuesta). */
async function assertPdtpObjectiveBelongsToProgram(objectiveId: string | null | undefined, programId: string): Promise<void> {
  if (!objectiveId) return
  const [objective] = await db.select({ id: pdtpObjectives.id })
    .from(pdtpObjectives)
    .where(and(eq(pdtpObjectives.id, objectiveId), eq(pdtpObjectives.programId, programId)))
    .limit(1)
  if (!objective) throw new Error("El objetivo seleccionado no existe en este programa.")
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
  if (input.objectiveId !== undefined) await assertPdtpObjectiveBelongsToProgram(input.objectiveId, input.programId)

  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.responsibleSlugs !== undefined) updates.responsibleSlugs = input.responsibleSlugs
  if (input.responsibleDisplay !== undefined) updates.responsibleDisplay = input.responsibleDisplay
  if (input.evidenceRequirement !== undefined) updates.evidenceRequirement = input.evidenceRequirement
  if (input.objectiveId !== undefined) updates.objectiveId = input.objectiveId
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

  const nextSubjectSource = input.subjectSource !== undefined ? input.subjectSource : activity.subjectSource
  // Cambiar de fuente arrastraba los códigos anteriores, y la validación los
  // rechazaba contra la fuente nueva: cambiar a `dotacion` era imposible sin
  // limpiar las capacidades en la misma llamada. Si la fuente nueva no es por
  // capacidad, los códigos dejan de significar algo y se limpian solos.
  const nextSubjectCapabilityCodes = input.subjectCapabilityCodes !== undefined
    ? normalizedSubjectCapabilityCodes(input.subjectCapabilityCodes)
    : nextSubjectSource === "trabajadores_capacidad" ? activity.subjectCapabilityCodes : null
  if (input.subjectSource !== undefined || input.subjectCapabilityCodes !== undefined) {
    await validateCapabilitySubjectConfiguration(nextSubjectSource, nextSubjectCapabilityCodes)
  }
  if (input.objectiveId !== undefined && input.objectiveId !== activity.objectiveId) {
    await assertPdtpObjectiveBelongsToProgram(input.objectiveId, activity.programId)
  }

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
  if (input.objectiveId !== undefined && input.objectiveId !== activity.objectiveId) {
    before.objectiveId = activity.objectiveId; after.objectiveId = input.objectiveId
    updates.objectiveId = input.objectiveId
  }
  const configurableFields = [
    "audienceRoles", "scheduleMode", "scheduleClassificationStatus", "recurrenceRule", "triggerType", "triggerDescription",
    "dueDays", "dueHours", "evidenceRequirement", "indicatorMode", "targetValue", "targetUnit",
    // Va junto a `indicatorMode` porque son la misma declaración partida en dos:
    // el modo dice "cuántos de cuántos" y la fuente dice de cuántos.
    "subjectSource", "subjectCapabilityCodes",
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
    updates[field] = field === "subjectCapabilityCodes"
      ? normalizedSubjectCapabilityCodes(input.subjectCapabilityCodes) as never
      : input[field] as never
  }

  // El bucle anterior sólo escribe lo que el llamador mencionó. La limpieza
  // implícita de capacidades al cambiar de fuente no viene en el input, así que
  // se registra acá para que quede también en el changelog.
  if (input.subjectCapabilityCodes === undefined
    && JSON.stringify(nextSubjectCapabilityCodes) !== JSON.stringify(activity.subjectCapabilityCodes)) {
    before.subjectCapabilityCodes = activity.subjectCapabilityCodes
    after.subjectCapabilityCodes = nextSubjectCapabilityCodes
    updates.subjectCapabilityCodes = nextSubjectCapabilityCodes as never
  }

  const horizon = deriveScheduleHorizon(program)
  const { cells: effectiveSchedule, origin: scheduleWriteOrigin } = resolveScheduleWrite({ input, activity, horizon })

  // Actividad + calendario + changelog en una sola transacción. El borrado de
  // celdas obsoletas es autoritativo, así que si commiteaba y los inserts
  // fallaban después quedaba la actividad con un calendario TRUNCADO —pérdida
  // silenciosa de cantidad planificada, que es el denominador del indicador—
  // y sin entrada de changelog que lo dejara trazado.
  return db.transaction(async (tx) => {
    const { currentCells, currentSource, scheduleDiff } = await writePdtpActivitySchedule(tx, {
      activityId: input.activityId,
      programYear: program.year,
      horizon,
      currentScheduleMode: activity.scheduleMode as "scheduled" | "on_demand" | "triggered",
      currentRecurrenceRule: activity.recurrenceRule as PdtpRecurrenceRule | null,
      cells: effectiveSchedule,
      // Comportamiento idéntico al original: la protección de planificación
      // manual sólo aplicaba cuando la escritura venía de proyectar una
      // regla, nunca cuando venía de la matriz manual (`scheduleOverrides`).
      guardAgainstManualOverwrite: scheduleWriteOrigin === "rule_projection",
      replaceConfirmed: Boolean(input.scheduleReplaceConfirmed),
      expectedFingerprint: input.expectedScheduleFingerprint,
    })

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
  const catalogDefinition = input.catalogActivityId ? await db.select({
    id: pdtpCatalogActivities.id,
    status: pdtpCatalogActivities.status,
    revision: pdtpCatalogActivities.currentRevision,
    description: pdtpCatalogActivityRevisions.description,
    executionGuidance: pdtpCatalogActivityRevisions.executionGuidance,
  }).from(pdtpCatalogActivities).innerJoin(pdtpCatalogActivityRevisions, and(
    eq(pdtpCatalogActivityRevisions.catalogActivityId, pdtpCatalogActivities.id),
    eq(pdtpCatalogActivityRevisions.revision, pdtpCatalogActivities.currentRevision),
  )).where(eq(pdtpCatalogActivities.id, input.catalogActivityId)).limit(1) : []
  const catalog = catalogDefinition[0]
  if (input.catalogActivityId && !catalog) throw new Error("Actividad de catálogo no encontrada.")
  // Retirada y borrador se rechazan por motivos distintos: la primera no
  // vuelve, la segunda sólo espera publicación. Un mensaje único mandaba a
  // buscar en la lista equivocada.
  if (catalog?.status === "retired") throw new Error("La actividad está retirada y no puede seleccionarse nuevamente.")
  if (catalog && catalog.status !== "active") throw new Error("La actividad debe estar publicada antes de incorporarla.")
  const subjectCapabilityCodes = normalizedSubjectCapabilityCodes(input.subjectCapabilityCodes)
  await validateCapabilitySubjectConfiguration(input.subjectSource ?? null, subjectCapabilityCodes)

  const existingActivities = await db.select({ n: pdtpActivities.n, displayOrder: pdtpActivities.displayOrder, catalogActivityId: pdtpActivities.catalogActivityId })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, input.programId))
  const maxN = existingActivities.reduce((m, row) => Math.max(m, row.n), 0)
  const maxDisplayOrder = existingActivities.reduce((m, row) => Math.max(m, row.displayOrder), 0)
  if (catalog && existingActivities.some((activity) => activity.catalogActivityId === catalog.id)) {
    throw new Error("La actividad ya está incorporada en este programa.")
  }
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
      catalogActivityId: catalog?.id ?? null,
      catalogRevision: catalog?.revision ?? null,
      activity: catalog?.description ?? input.activity,
      program: catalog?.executionGuidance ?? input.program,
      responsibleSlugs: input.responsibleSlugs, responsibleDisplay: input.responsibleDisplay,
      audienceRoles: input.audienceRoles ?? [], scheduleMode: input.scheduleMode ?? "scheduled",
      scheduleClassificationStatus: input.scheduleClassificationStatus ?? "confirmed",
      recurrenceRule: input.recurrenceRule ?? null, triggerType: input.triggerType ?? null,
      triggerDescription: input.triggerDescription ?? null, dueDays: input.dueDays ?? null,
      dueHours: input.dueHours ?? null,
      evidenceRequirement: input.evidenceRequirement ?? null, indicatorMode: input.indicatorMode ?? "planned_vs_completed",
      subjectSource: input.subjectSource ?? null, subjectCapabilityCodes,
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

    await addPdtpChangeLogEntry(input.programId, program.version, userId, `activity:${newN}`, null, {
      n: newN,
      catalogActivityId: catalog?.id ?? null,
      catalogRevision: catalog?.revision ?? null,
      activity: catalog?.description ?? input.activity,
      sheetCodes: input.sheetCodes,
    }, catalog ? `Actividad ${newN} incorporada desde catálogo.` : `Actividad ${newN} agregada manualmente.`, tx)
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
  if (source.catalogActivityId) throw new Error("Una identidad de catálogo no puede repetirse dentro del mismo programa.")
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
      dueHours: source.dueHours,
      evidenceRequirement: source.evidenceRequirement,
      indicatorMode: source.indicatorMode,
      subjectSource: source.subjectSource,
      subjectCapabilityCodes: source.subjectCapabilityCodes,
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
