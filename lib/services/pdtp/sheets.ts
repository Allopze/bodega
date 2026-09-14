import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpExecutions, pdtpPrograms, pdtpProgramWorksites, pdtpSheetActivities, pdtpSheets } from "@/db/schema"
import { MONTH_LABELS } from "./constants"
import { SHEET_EXPORT_NAMES } from "@/lib/services/pdtp-adapters/sheet-meta-2026"
import { assertWorksiteAccess, emptyMonthlyTotals, loadProgramScheduleAndExecutions, resolveSheetForProgram } from "./helpers"
import type { WorksiteScope } from "./helpers"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import type { ReportData, ReportCell, ReportSheet } from "@/lib/reports/export"
// `sheetCode` es `string`, no `PdtpSheetCode`: un programa distinto al 2026
// puede tener vistas propias con cualquier código. `SHEET_EXPORT_NAMES` solo
// cubre las ocho hojas de la referencia 2026; para cualquier otro código se
// usa `sheet.label`, que sí es genérico (ver getPdtpSheetViewByProgram).
import { listActionsByProgram, countActionsByExecution } from "./action-plan"
import { listFollowups } from "./followups"
import { countNoCumpleByExecution } from "./execution-checklists"
import { readPdtpActivityContent } from "./activity-content"
import { deriveActivityStatus, filterPdtpRowsFromActivation, type PdtpActivityStatus, type PdtpPeriod } from "./period"

export type PdtpSheetView = {
  program: typeof pdtpPrograms.$inferSelect
  sheet: typeof pdtpSheets.$inferSelect
  activities: Array<typeof pdtpActivities.$inferSelect & {
    schedule: Array<typeof pdtpActivitySchedule.$inferSelect>
    /** Cronograma exigible desde la activación; `schedule` conserva el plan
     * histórico completo para trazabilidad y exportación. */
    effectiveSchedule: Array<typeof pdtpActivitySchedule.$inferSelect>
    totalPlanned: number
    totalExecuted: number
    monthlyPlanned: number[]
    monthlyExecuted: number[]
    effectiveTotalPlanned: number
    effectiveTotalExecuted: number
    effectiveMonthlyPlanned: number[]
    effectiveMonthlyExecuted: number[]
    executions: Array<{
      id: string
      year: number
      month: number
      week: number
      executedQuantity: number
      status: string
      evidenceText: string | null
      evidenceUrl: string | null
      evidencePhotos: string[]
      noCumpleCount: number
      actionsPending: number
      actionsOverdue: number
    }>
  }>
  /** Estos totales conservan el plan y avance históricos completos. Los
   * estados y KPI exigibles deben usar los campos `effective*` de actividad.
   * `percent` aquí es entero 0-100 (no fracción). No confundir con
   * `PdtpComplianceIndicators.percent`, que es fracción 0-1 para compararse
   * directo contra `complianceTarget`. Hoy `monthlyTotals[].percent` no se
   * renderiza en ninguna UI (solo `planned`/`executed`); si se consume, usar
   * este valor tal cual (ya es %, no multiplicar por 100 de nuevo). */
  monthlyTotals: Array<{ month: number; planned: number; executed: number; percent: number | null }>
}

/**
 * Lectura agregada por alcance. No lleva ejecuciones ni evidencias individuales:
 * esas sólo se entregan mediante la vista detallada de una faena concreta.
 */
export type PdtpAggregateActivityWorksite = {
  worksiteId: string
  planned: number
  executed: number
  status: PdtpActivityStatus
}

export type PdtpAggregatedSheetView = Omit<PdtpSheetView, "activities"> & {
  aggregate: true
  activities: Array<PdtpSheetView["activities"][number] & { worksiteSummaries: PdtpAggregateActivityWorksite[] }>
  worksiteSummaries: Array<{ worksiteId: string; planned: number; executed: number }>
}

export async function getPdtpAggregatedSheetViewByProgram(
  programId: string,
  sheetCode: string,
  worksiteIds: string[],
  period: PdtpPeriod,
): Promise<PdtpAggregatedSheetView | null> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null
  const members = await db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
  const memberIds = new Set(members.map((member) => member.worksiteId))
  const authorizedWorksiteIds = members.length === 0
    ? [...new Set(worksiteIds)]
    : [...new Set(worksiteIds.filter((worksiteId) => memberIds.has(worksiteId)))]
  const sheet = await resolveSheetForProgram(programId, sheetCode)
  if (!sheet) return null
  const memberships = await db.select().from(pdtpSheetActivities)
    .where(eq(pdtpSheetActivities.sheetId, sheet.id))
    .orderBy(pdtpSheetActivities.displayOrder)
  if (memberships.length === 0) return { program, sheet, activities: [], monthlyTotals: emptyMonthlyTotals(), aggregate: true, worksiteSummaries: [] }

  const activityIds = memberships.map((membership) => membership.activityId)
  const [activityRows, loadedPerWorksite] = await Promise.all([
    db.select().from(pdtpActivities).where(and(inArray(pdtpActivities.id, activityIds), eq(pdtpActivities.programId, programId))),
    Promise.all(authorizedWorksiteIds.map(async (worksiteId) => ({ worksiteId, ...(await loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId)) }))),
  ])
  const effectivePerWorksite = loadedPerWorksite.map((entry) => ({
    ...entry,
    scheduleRows: filterPdtpRowsFromActivation(entry.scheduleRows, program.activatedAt),
    executionRows: filterPdtpRowsFromActivation(entry.executionRows, program.activatedAt),
  }))
  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]))
  const schedulesByActivity = new Map<string, Array<typeof pdtpActivitySchedule.$inferSelect>>()
  const executionsByActivity = new Map<string, Array<typeof pdtpExecutions.$inferSelect>>()
  const effectiveSchedulesByActivity = new Map<string, Array<typeof pdtpActivitySchedule.$inferSelect>>()
  const effectiveExecutionsByActivity = new Map<string, Array<typeof pdtpExecutions.$inferSelect>>()
  const worksiteSummaries = effectivePerWorksite.map(({ worksiteId, scheduleRows, executionRows }) => ({
    worksiteId,
    planned: scheduleRows.reduce((total, row) => total + row.plannedQuantity, 0),
    executed: executionRows.filter((row) => row.status === "approved").reduce((total, row) => total + row.executedQuantity, 0),
  }))
  for (const { scheduleRows, executionRows } of loadedPerWorksite) {
    for (const row of scheduleRows) {
      const rows = schedulesByActivity.get(row.activityId) ?? []
      rows.push(row)
      schedulesByActivity.set(row.activityId, rows)
    }
    for (const row of executionRows) {
      const rows = executionsByActivity.get(row.activityId) ?? []
      rows.push(row)
      executionsByActivity.set(row.activityId, rows)
    }
  }
  for (const { scheduleRows, executionRows } of effectivePerWorksite) {
    for (const row of scheduleRows) {
      const rows = effectiveSchedulesByActivity.get(row.activityId) ?? []
      rows.push(row)
      effectiveSchedulesByActivity.set(row.activityId, rows)
    }
    for (const row of executionRows) {
      const rows = effectiveExecutionsByActivity.get(row.activityId) ?? []
      rows.push(row)
      effectiveExecutionsByActivity.set(row.activityId, rows)
    }
  }
  const monthlyTotals = emptyMonthlyTotals()
  const activities: PdtpAggregatedSheetView["activities"] = []
  for (const membership of memberships) {
    const activity = activityById.get(membership.activityId)
    if (!activity) continue
    const schedule = (schedulesByActivity.get(activity.id) ?? []).sort((a, b) => a.month - b.month || a.week - b.week)
    const effectiveSchedule = (effectiveSchedulesByActivity.get(activity.id) ?? []).sort((a, b) => a.month - b.month || a.week - b.week)
    const monthlyPlanned = Array.from({ length: 12 }, () => 0)
    const monthlyExecuted = Array.from({ length: 12 }, () => 0)
    const effectiveMonthlyPlanned = Array.from({ length: 12 }, () => 0)
    const effectiveMonthlyExecuted = Array.from({ length: 12 }, () => 0)
    for (const row of schedule) {
      monthlyPlanned[row.month - 1]! += row.plannedQuantity
      monthlyTotals[row.month - 1]!.planned += row.plannedQuantity
    }
    for (const row of executionsByActivity.get(activity.id) ?? []) {
      if (row.status !== "approved") continue
      monthlyExecuted[row.month - 1]! += row.executedQuantity
      monthlyTotals[row.month - 1]!.executed += row.executedQuantity
    }
    for (const row of effectiveSchedule) effectiveMonthlyPlanned[row.month - 1]! += row.plannedQuantity
    for (const row of effectiveExecutionsByActivity.get(activity.id) ?? []) {
      if (row.status === "approved") effectiveMonthlyExecuted[row.month - 1]! += row.executedQuantity
    }
    const activityWorksiteSummaries = effectivePerWorksite.map(({ worksiteId, scheduleRows, executionRows }) => {
      const plannedByMonth = Array.from({ length: 12 }, () => 0)
      const executedByMonth = Array.from({ length: 12 }, () => 0)
      for (const row of scheduleRows) if (row.activityId === activity.id) plannedByMonth[row.month - 1]! += row.plannedQuantity
      for (const row of executionRows) if (row.activityId === activity.id && row.status === "approved") executedByMonth[row.month - 1]! += row.executedQuantity
      return {
        worksiteId,
        planned: plannedByMonth.reduce((sum, value) => sum + value, 0),
        executed: executedByMonth.reduce((sum, value) => sum + value, 0),
        status: deriveActivityStatus(plannedByMonth, executedByMonth, period),
      }
    })
    activities.push({
      ...activity,
      schedule,
      effectiveSchedule,
      monthlyPlanned,
      monthlyExecuted,
      effectiveMonthlyPlanned,
      effectiveMonthlyExecuted,
      totalPlanned: monthlyPlanned.reduce((sum, value) => sum + value, 0),
      totalExecuted: monthlyExecuted.reduce((sum, value) => sum + value, 0),
      effectiveTotalPlanned: effectiveMonthlyPlanned.reduce((sum, value) => sum + value, 0),
      effectiveTotalExecuted: effectiveMonthlyExecuted.reduce((sum, value) => sum + value, 0),
      executions: [],
      worksiteSummaries: activityWorksiteSummaries,
    })
  }
  for (const month of monthlyTotals) month.percent = month.planned > 0 ? Math.round((month.executed / month.planned) * 100) : null
  return { program, sheet, activities, monthlyTotals, aggregate: true, worksiteSummaries }
}

/**
 * Vista de hoja PDTP por programId. Busca la hoja (template o program-scoped)
 * y filtra las actividades al programa indicado.
 */
export async function getPdtpSheetViewByProgram(programId: string, sheetCode: string, worksiteId?: string): Promise<PdtpSheetView | null> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null

  const sheet = await resolveSheetForProgram(programId, sheetCode)
  if (!sheet) return null

  const memberships = await db.select().from(pdtpSheetActivities)
    .where(eq(pdtpSheetActivities.sheetId, sheet.id))
    .orderBy(pdtpSheetActivities.displayOrder)
  if (memberships.length === 0) {
    return { program, sheet, activities: [], monthlyTotals: emptyMonthlyTotals() }
  }

  const activityIds = memberships.map((m) => m.activityId)
  const [activityRows, loaded] = await Promise.all([
    db.select().from(pdtpActivities).where(and(
      inArray(pdtpActivities.id, activityIds),
      eq(pdtpActivities.programId, programId),
    )),
    loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId),
  ])
  // La vista conserva el cronograma y las ejecuciones completas. El recorte de
  // vigencia vive en campos `effective*`, usados sólo por estados y KPI.
  const scheduleRows = loaded.scheduleRows
  const executionRows = loaded.executionRows

  const activityById = new Map(activityRows.map((a) => [a.id, a]))
  const scheduleByActivity = new Map<string, Array<typeof pdtpActivitySchedule.$inferSelect>>()
  for (const s of scheduleRows) {
    const current = scheduleByActivity.get(s.activityId) ?? []
    current.push(s)
    scheduleByActivity.set(s.activityId, current)
  }
  const executionsByActivity = new Map<string, Array<typeof pdtpExecutions.$inferSelect>>()
  for (const e of executionRows) {
    const current = executionsByActivity.get(e.activityId) ?? []
    current.push(e)
    executionsByActivity.set(e.activityId, current)
  }

  // Badges de checklist/plan de acción por ejecución: dos queries batch (no
  // N+1 por ejecución) sobre todas las ejecuciones del programa.
  const executionIds = executionRows.map((e) => e.id)
  const [noCumpleByExecution, actionsByExecution] = await Promise.all([
    countNoCumpleByExecution(executionIds),
    countActionsByExecution(executionIds),
  ])

  const monthlyTotals = emptyMonthlyTotals()
  const activities: Array<NonNullable<PdtpSheetView["activities"][number]>> = []
  for (const membership of memberships) {
    const activity = activityById.get(membership.activityId)
    // Skip sheet memberships from other programs (template sheets can be
    // shared across programs, so a membership may reference an activity
    // from a different program that was filtered out above).
    if (!activity) continue
    const schedule = (scheduleByActivity.get(activity.id) ?? []).sort((a, b) => a.month - b.month || a.week - b.week)
    const effectiveSchedule = filterPdtpRowsFromActivation(schedule, program.activatedAt)
    const monthlyPlanned = Array.from({ length: 12 }, () => 0)
    const monthlyExecuted = Array.from({ length: 12 }, () => 0)
    const effectiveMonthlyPlanned = Array.from({ length: 12 }, () => 0)
    const effectiveMonthlyExecuted = Array.from({ length: 12 }, () => 0)

    for (const cell of schedule) {
      monthlyPlanned[cell.month - 1] = (monthlyPlanned[cell.month - 1] ?? 0) + cell.plannedQuantity
      monthlyTotals[cell.month - 1]!.planned += cell.plannedQuantity
    }
    const activityExecutions = executionsByActivity.get(activity.id) ?? []
    for (const execution of activityExecutions) {
      monthlyExecuted[execution.month - 1] = (monthlyExecuted[execution.month - 1] ?? 0) + execution.executedQuantity
      monthlyTotals[execution.month - 1]!.executed += execution.executedQuantity
    }
    for (const cell of effectiveSchedule) {
      effectiveMonthlyPlanned[cell.month - 1] = (effectiveMonthlyPlanned[cell.month - 1] ?? 0) + cell.plannedQuantity
    }
    for (const execution of filterPdtpRowsFromActivation(activityExecutions, program.activatedAt)) {
      effectiveMonthlyExecuted[execution.month - 1] = (effectiveMonthlyExecuted[execution.month - 1] ?? 0) + execution.executedQuantity
    }

    activities.push({
      ...activity, schedule, effectiveSchedule, monthlyPlanned, monthlyExecuted,
      effectiveMonthlyPlanned, effectiveMonthlyExecuted,
      totalPlanned: monthlyPlanned.reduce((s, v) => s + v, 0),
      totalExecuted: monthlyExecuted.reduce((s, v) => s + v, 0),
      effectiveTotalPlanned: effectiveMonthlyPlanned.reduce((s, v) => s + v, 0),
      effectiveTotalExecuted: effectiveMonthlyExecuted.reduce((s, v) => s + v, 0),
      executions: activityExecutions
        .filter((e) => e.evidenceUrl || (Array.isArray(e.evidencePhotos) && e.evidencePhotos.length > 0) || e.evidenceText)
        .map((e) => ({
          id: e.id,
          year: e.year,
          month: e.month,
          week: e.week,
          executedQuantity: e.executedQuantity,
          status: e.status,
          evidenceText: e.evidenceText,
          evidenceUrl: e.evidenceUrl,
          evidencePhotos: Array.isArray(e.evidencePhotos) ? e.evidencePhotos : [],
          noCumpleCount: noCumpleByExecution.get(e.id) ?? 0,
          actionsPending: actionsByExecution.get(e.id)?.pending ?? 0,
          actionsOverdue: actionsByExecution.get(e.id)?.overdue ?? 0,
        })),
    })
  }

  for (const month of monthlyTotals) {
    month.percent = month.planned > 0 ? Math.round((month.executed / month.planned) * 100) : null
  }

  return { program, sheet, activities, monthlyTotals }
}

/**
 * HALLAZGO SEC-002 (S3/P2): `scope` tenía `= "all"` como valor por omisión, o
 * sea que olvidarlo no restringía sino que **abría** el export a todas las
 * faenas. Ahora es obligatorio: omitirlo no compila.
 */
export async function buildPdtpExport({ programId, year, sheetCode, worksiteId, scope }: {
  programId?: string; year: number; sheetCode: string; worksiteId: string; scope: WorksiteScope
}): Promise<ReportData> {
  assertWorksiteAccess(worksiteId, scope)
  const view = programId
    ? await getPdtpSheetViewByProgram(programId, sheetCode, worksiteId)
    : await getPdtpSheetView(year, sheetCode, worksiteId)
  if (!view) {
    // Antes esto devolvía un Excel "vacío" (headers/rows []) sin avisar al
    // usuario que no existe programa/hoja para ese año o sheetCode. Mejor
    // fallar explícito: el caller (route de export) ya maneja errores.
    throw new Error(`No se encontró un programa PDTP para ${programId ? `programId=${programId}` : `año ${year}`} / hoja ${sheetCode}.`)
  }

  const monthHeaders = MONTH_LABELS.flatMap((month) => [`${month} P`, `${month} E`])
  const headers = ["N°", "Actividad preventiva", "Guía de ejecución", "Responsables", ...monthHeaders, "Plan anual", "Ejecutado anual", "%"]
  const rows: ReportCell[][] = view.activities.map((activity) => {
    const content = readPdtpActivityContent(activity)
    const monthly = MONTH_LABELS.flatMap((_, index) => [activity.monthlyPlanned[index] ?? 0, activity.monthlyExecuted[index] ?? 0])
    const percent = activity.totalPlanned > 0 ? Math.round((activity.totalExecuted / activity.totalPlanned) * 100) : null
    return [activity.n, content.activityDescription, content.executionGuidance, activity.responsibleDisplay, ...monthly, activity.totalPlanned, activity.totalExecuted, percent]
  })

  const actionItems = await listActionsByProgram(view.program.id, scope, { worksiteId })
  const actionPlanSheet = buildActionPlanSheet(actionItems)
  const seguimientoSheet = await buildSeguimientoSheet(actionItems)

  // Nombre de hoja: el catálogo de nombres 2026 solo cubre sus ocho códigos
  // fijos; cualquier otro programa usa el label real de su vista (`view.sheet`),
  // que ya es un dato general por-programa y no depende del adaptador 2026.
  const worksheetName = SHEET_EXPORT_NAMES[sheetCode as PdtpSheetCode] ?? view.sheet.label

  // El filename usa el año real del programa (view.program.year), no el
  // arg `year`: cuando el caller pasa `programId`, ese `year` puede venir
  // de un `?year=` legado que no coincide con el programa resuelto.
  return {
    filenameBase: `pdtp-sg-sst-${view.program.year}-${sheetCode}`,
    worksheetName,
    headers,
    rows,
    sheets: [
      { worksheetName, headers, rows },
      actionPlanSheet,
      seguimientoSheet,
    ],
  }
}

function buildActionPlanSheet(items: Awaited<ReturnType<typeof listActionsByProgram>>): ReportSheet {
  const headers = ["N°", "Hallazgo", "Acción", "Responsable", "Rol", "Plazo", "Prioridad", "Estado", "Vencida"]
  const rows: ReportCell[][] = items.map((item) => [
    item.n, item.hallazgo, item.accion, item.responsable, item.responsableRole,
    item.plazo, item.prioridad, item.estado, item.vencida ? "Sí" : "No",
  ])
  return { worksheetName: "Plan de acción", headers, rows }
}

async function buildSeguimientoSheet(items: Awaited<ReturnType<typeof listActionsByProgram>>): Promise<ReportSheet> {
  const headers = ["Acción N°", "Fecha", "Estado anterior", "Estado nuevo", "Observación"]
  const rows = (await Promise.all(items.map(async (item) => {
    const followups = await listFollowups(item.id)
    return followups.map((followup): ReportCell[] => [
      item.n,
      followup.fecha,
      followup.estadoAnterior,
      followup.estadoNuevo,
      followup.observacion,
    ])
  }))).flat()
  return { worksheetName: "Seguimiento", headers, rows }
}

/**
 * Backward-compatible: busca por año. Usa el programa activo o el más reciente.
 */
export async function getPdtpSheetView(year: number, sheetCode: string, worksiteId?: string): Promise<PdtpSheetView | null> {
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
    .orderBy(desc(pdtpPrograms.version))
  const program = programs.find((p) => p.status === "active") ?? programs[0]
  if (!program) return null
  return getPdtpSheetViewByProgram(program.id, sheetCode, worksiteId)
}
