import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpExecutions, pdtpPrograms, pdtpSheetActivities, pdtpSheets } from "@/db/schema"
import { SHEET_EXPORT_NAMES, MONTH_LABELS } from "./constants"
import { emptyMonthlyTotals, loadProgramScheduleAndExecutions } from "./helpers"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import type { ReportData, ReportCell } from "@/lib/reports/export"

export type PdtpSheetView = {
  program: typeof pdtpPrograms.$inferSelect
  sheet: typeof pdtpSheets.$inferSelect
  activities: Array<typeof pdtpActivities.$inferSelect & {
    schedule: Array<typeof pdtpActivitySchedule.$inferSelect>
    totalPlanned: number
    totalExecuted: number
    monthlyPlanned: number[]
    monthlyExecuted: number[]
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
    }>
  }>
  monthlyTotals: Array<{ month: number; planned: number; executed: number; percent: number | null }>
}

/**
 * Vista de hoja PDTP por programId. Busca la hoja (template o program-scoped)
 * y filtra las actividades al programa indicado.
 */
export async function getPdtpSheetViewByProgram(programId: string, sheetCode: PdtpSheetCode, worksiteId?: string): Promise<PdtpSheetView | null> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null

  const [sheet] = await db.select().from(pdtpSheets)
    .where(and(
      eq(pdtpSheets.code, sheetCode),
      or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)),
    ))
    .limit(1)
  if (!sheet) return null

  const memberships = await db.select().from(pdtpSheetActivities)
    .where(eq(pdtpSheetActivities.sheetId, sheet.id))
    .orderBy(pdtpSheetActivities.displayOrder)
  if (memberships.length === 0) {
    return { program, sheet, activities: [], monthlyTotals: emptyMonthlyTotals() }
  }

  const activityIds = memberships.map((m) => m.activityId)
  const [activityRows, { scheduleRows, executionRows }] = await Promise.all([
    db.select().from(pdtpActivities).where(and(
      inArray(pdtpActivities.id, activityIds),
      eq(pdtpActivities.programId, programId),
    )),
    loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId),
  ])

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

  const monthlyTotals = emptyMonthlyTotals()
  const activities = memberships.map((membership) => {
    const activity = activityById.get(membership.activityId)
    if (!activity) throw new Error(`Membresia PDTP referencia actividad inexistente: ${membership.activityId}.`)
    const schedule = (scheduleByActivity.get(activity.id) ?? []).sort((a, b) => a.month - b.month || a.week - b.week)
    const monthlyPlanned = Array.from({ length: 12 }, () => 0)
    const monthlyExecuted = Array.from({ length: 12 }, () => 0)

    for (const cell of schedule) {
      monthlyPlanned[cell.month - 1] = (monthlyPlanned[cell.month - 1] ?? 0) + cell.plannedQuantity
      monthlyTotals[cell.month - 1]!.planned += cell.plannedQuantity
    }
    const activityExecutions = executionsByActivity.get(activity.id) ?? []
    for (const execution of activityExecutions) {
      monthlyExecuted[execution.month - 1] = (monthlyExecuted[execution.month - 1] ?? 0) + execution.executedQuantity
      monthlyTotals[execution.month - 1]!.executed += execution.executedQuantity
    }

    return {
      ...activity, schedule, monthlyPlanned, monthlyExecuted,
      totalPlanned: monthlyPlanned.reduce((s, v) => s + v, 0),
      totalExecuted: monthlyExecuted.reduce((s, v) => s + v, 0),
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
        })),
    }
  })

  for (const month of monthlyTotals) {
    month.percent = month.planned > 0 ? Math.round((month.executed / month.planned) * 100) : null
  }

  return { program, sheet, activities, monthlyTotals }
}

export async function buildPdtpExport({ programId, year, sheetCode, worksiteId }: {
  programId?: string; year: number; sheetCode: PdtpSheetCode; worksiteId?: string
}): Promise<ReportData> {
  const view = programId
    ? await getPdtpSheetViewByProgram(programId, sheetCode, worksiteId)
    : await getPdtpSheetView(year, sheetCode, worksiteId)
  if (!view) {
    return { filenameBase: `pdtp-sg-sst-${year}-${sheetCode}`, worksheetName: SHEET_EXPORT_NAMES[sheetCode], headers: [], rows: [] }
  }

  const monthHeaders = MONTH_LABELS.flatMap((month) => [`${month} P`, `${month} E`])
  const headers = ["N°", "Objetivo", "Actividad", "Programa", "Responsables", ...monthHeaders, "Plan anual", "Ejecutado anual", "%"]
  const rows: ReportCell[][] = view.activities.map((activity) => {
    const monthly = MONTH_LABELS.flatMap((_, index) => [activity.monthlyPlanned[index] ?? 0, activity.monthlyExecuted[index] ?? 0])
    const percent = activity.totalPlanned > 0 ? Math.round((activity.totalExecuted / activity.totalPlanned) * 100) : null
    return [activity.n, activity.objective, activity.activity, activity.program, activity.responsibleDisplay, ...monthly, activity.totalPlanned, activity.totalExecuted, percent]
  })

  return { filenameBase: `pdtp-sg-sst-${year}-${sheetCode}`, worksheetName: SHEET_EXPORT_NAMES[sheetCode], headers, rows }
}

/**
 * Backward-compatible: busca por año. Usa el programa activo o el más reciente.
 */
export async function getPdtpSheetView(year: number, sheetCode: PdtpSheetCode, worksiteId?: string): Promise<PdtpSheetView | null> {
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
  const program = programs.find((p) => p.status === "active") ?? programs[0]
  if (!program) return null
  return getPdtpSheetViewByProgram(program.id, sheetCode, worksiteId)
}
