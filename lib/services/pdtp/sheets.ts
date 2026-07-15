import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpExecutions, pdtpPrograms, pdtpSheetActivities, pdtpSheets } from "@/db/schema"
import { SHEET_EXPORT_NAMES, MONTH_LABELS } from "./constants"
import { emptyMonthlyTotals, loadProgramScheduleAndExecutions, resolveSheetForProgram } from "./helpers"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import type { ReportData, ReportCell, ReportSheet } from "@/lib/reports/export"
import { listActionsByProgram } from "./action-plan"
import { listFollowups } from "./followups"

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
  /** `percent` aquí es entero 0-100 (no fracción). No confundir con
   * `PdtpComplianceIndicators.percent`, que es fracción 0-1 para compararse
   * directo contra `complianceTarget`. Hoy `monthlyTotals[].percent` no se
   * renderiza en ninguna UI (solo `planned`/`executed`); si se consume, usar
   * este valor tal cual (ya es %, no multiplicar por 100 de nuevo). */
  monthlyTotals: Array<{ month: number; planned: number; executed: number; percent: number | null }>
}

/**
 * Vista de hoja PDTP por programId. Busca la hoja (template o program-scoped)
 * y filtra las actividades al programa indicado.
 */
export async function getPdtpSheetViewByProgram(programId: string, sheetCode: PdtpSheetCode, worksiteId?: string): Promise<PdtpSheetView | null> {
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
  const activities: Array<NonNullable<PdtpSheetView["activities"][number]>> = []
  for (const membership of memberships) {
    const activity = activityById.get(membership.activityId)
    // Skip sheet memberships from other programs (template sheets can be
    // shared across programs, so a membership may reference an activity
    // from a different program that was filtered out above).
    if (!activity) continue
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

    activities.push({
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
    })
  }

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
    // Antes esto devolvía un XLSX "vacío" (headers/rows []) sin avisar al
    // usuario que no existe programa/hoja para ese año o sheetCode. Mejor
    // fallar explícito: el caller (route de export) ya maneja errores.
    throw new Error(`No se encontró un programa PDTP para ${programId ? `programId=${programId}` : `año ${year}`} / hoja ${sheetCode}.`)
  }

  const monthHeaders = MONTH_LABELS.flatMap((month) => [`${month} P`, `${month} E`])
  const headers = ["N°", "Objetivo", "Actividad", "Programa", "Responsables", ...monthHeaders, "Plan anual", "Ejecutado anual", "%"]
  const rows: ReportCell[][] = view.activities.map((activity) => {
    const monthly = MONTH_LABELS.flatMap((_, index) => [activity.monthlyPlanned[index] ?? 0, activity.monthlyExecuted[index] ?? 0])
    const percent = activity.totalPlanned > 0 ? Math.round((activity.totalExecuted / activity.totalPlanned) * 100) : null
    return [activity.n, activity.objective, activity.activity, activity.program, activity.responsibleDisplay, ...monthly, activity.totalPlanned, activity.totalExecuted, percent]
  })

  const actionItems = await listActionsByProgram(view.program.id, { worksiteId })
  const actionPlanSheet = buildActionPlanSheet(actionItems)
  const seguimientoSheet = await buildSeguimientoSheet(actionItems)

  // El filename usa el año real del programa (view.program.year), no el
  // arg `year`: cuando el caller pasa `programId`, ese `year` puede venir
  // de un `?year=` legado que no coincide con el programa resuelto.
  return {
    filenameBase: `pdtp-sg-sst-${view.program.year}-${sheetCode}`,
    worksheetName: SHEET_EXPORT_NAMES[sheetCode],
    headers,
    rows,
    sheets: [
      { worksheetName: SHEET_EXPORT_NAMES[sheetCode], headers, rows },
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
  const rows: ReportCell[][] = []
  for (const item of items) {
    const followups = await listFollowups(item.id)
    for (const f of followups) {
      rows.push([item.n, f.fecha, f.estadoAnterior, f.estadoNuevo, f.observacion])
    }
  }
  return { worksheetName: "Seguimiento", headers, rows }
}

/**
 * Backward-compatible: busca por año. Usa el programa activo o el más reciente.
 */
export async function getPdtpSheetView(year: number, sheetCode: PdtpSheetCode, worksiteId?: string): Promise<PdtpSheetView | null> {
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
    .orderBy(desc(pdtpPrograms.version))
  const program = programs.find((p) => p.status === "active") ?? programs[0]
  if (!program) return null
  return getPdtpSheetViewByProgram(program.id, sheetCode, worksiteId)
}
