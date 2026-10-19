import ExcelJS from "exceljs"
import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionCapaFollowups,
  preventionInspectionFindings,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  users,
  worksites,
} from "@/db/schema"
import type { InspectionAccess } from "@/lib/services/prevention-inspections"
import { capaStatusLabel } from "@/lib/prevention/capa"
import { FINDING_CRITICALITY_LABELS, INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import { formatDateTime } from "@/lib/utils"

export interface InspectionFollowupRow {
  findingId: string
  runId: string
  /** Código de la inspección (`INS-…`), para citarla y enlazarla. */
  runCode: string
  kind: string
  date: string | null
  area: string
  deviation: string
  correctiveMeasure: string
  responsible: string
  targetDate: string | null
  status: string
  progress: number
  comments: string
  worksiteId: string
  worksiteName: string
  /** Sujeto inspeccionado tal como quedó congelado en la ejecución; `null` si no se declaró. */
  subjectLabel: string | null
  /** Criticidad del hallazgo (`low`…`critical`), cruda: quien la muestra la traduce. */
  criticality: string
  /** Estado del hallazgo (`open`, `capa_linked`, `closed`), crudo. */
  findingStatus: string
  actionId: string | null
  /** Código de la acción CAPA (`CAPA-…`); `null` si el hallazgo no tiene acción. */
  actionCode: string | null
  /** Estado de la acción CAPA, crudo; `status` ya trae su etiqueta. */
  capaStatus: string | null
}

export async function listInspectionFollowup(access: InspectionAccess): Promise<InspectionFollowupRow[]> {
  if (!access.permissions.includes("prevention:inspections:view")) throw new Error("Inspección no encontrada o fuera de alcance.")
  const responsible = alias(users, "inspection_followup_responsible")
  if (access.scope.mode === "none" || (access.scope.mode === "some" && access.scope.ids.length === 0)) return []
  const base = await db.select({
    findingId: preventionInspectionFindings.id,
    runId: preventionInspectionRuns.id,
    runCode: preventionInspectionRuns.code,
    kind: preventionInspectionTemplates.kind,
    executedAt: preventionInspectionRuns.executedAt,
    scheduledFor: preventionInspectionRuns.scheduledFor,
    subjectLabel: preventionInspectionRuns.subjectLabel,
    worksiteId: preventionInspectionRuns.worksiteId,
    worksiteName: worksites.name,
    deviation: preventionInspectionFindings.description,
    criticality: preventionInspectionFindings.criticality,
    findingStatus: preventionInspectionFindings.status,
    actionId: preventionCapaActions.id,
    actionCode: preventionCapaActions.code,
    actionDescription: preventionCapaActions.actionDescription,
    responsibleName: responsible.name,
    responsibleSnapshot: preventionCapaActions.responsibleSnapshot,
    targetDate: preventionCapaActions.targetDate,
    status: preventionCapaActions.status,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
    .leftJoin(responsible, eq(responsible.id, preventionCapaActions.responsibleUserId))
    .where(access.scope.mode === "all" ? undefined : inArray(preventionInspectionRuns.worksiteId, access.scope.ids))
    .orderBy(asc(preventionInspectionRuns.executedAt), asc(preventionInspectionFindings.createdAt))

  const scoped = base
  const actionIds = scoped.flatMap((row) => row.actionId ? [row.actionId] : [])
  const followups = actionIds.length === 0 ? [] : await db.select({
    actionId: preventionCapaFollowups.actionId,
    note: preventionCapaFollowups.note,
    progress: preventionCapaFollowups.progress,
    createdAt: preventionCapaFollowups.createdAt,
    author: users.name,
  }).from(preventionCapaFollowups)
    .innerJoin(users, eq(users.id, preventionCapaFollowups.createdByUserId))
    .where(inArray(preventionCapaFollowups.actionId, actionIds))
    .orderBy(asc(preventionCapaFollowups.createdAt))
  const byAction = new Map<string, typeof followups>()
  for (const followup of followups) {
    const rows = byAction.get(followup.actionId) ?? []
    rows.push(followup)
    byAction.set(followup.actionId, rows)
  }

  return scoped.map((row) => {
    const history = row.actionId ? byAction.get(row.actionId) ?? [] : []
    const explicitProgress = [...history].reverse().find((item) => item.progress !== null)?.progress
    const progress = explicitProgress ?? (["verified", "closed"].includes(row.status ?? "") ? 100 : 0)
    return {
      findingId: row.findingId,
      runId: row.runId,
      runCode: row.runCode,
      kind: row.kind,
      date: row.executedAt ?? row.scheduledFor,
      area: row.subjectLabel?.trim() || row.worksiteName,
      deviation: row.deviation,
      correctiveMeasure: row.actionDescription ?? "",
      responsible: row.responsibleName ?? row.responsibleSnapshot ?? "",
      targetDate: row.targetDate,
      status: row.status ? capaStatusLabel(row.status) : "Sin CAPA",
      progress,
      comments: history.map((item) => `${formatDateTime(item.createdAt)} · ${item.author}: ${item.note}`).join("\n"),
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      subjectLabel: row.subjectLabel?.trim() || null,
      criticality: row.criticality,
      findingStatus: row.findingStatus,
      actionId: row.actionId,
      actionCode: row.actionCode,
      capaStatus: row.status,
    }
  })
}

/**
 * Anexo 15 oficial: estos nueve encabezados, su orden y los nombres de hoja de más abajo no se
 * tocan (decisión del 2026-10-19): el archivo es el formato oficial y hay quien lo consume por
 * posición. «Status» y «SEGUIMENTO» parecen erratas y se conservan a propósito: solo se agregan
 * columnas a la derecha y se corrigen las fechas y los datos.
 */
const HEADERS = ["Fecha", "Área", "Desviación", "Medidas correctivas", "Responsable", "Fecha Ejecución MC", "Status", "% Cumplimiento", "Comentarios"]

/**
 * Lo que el Anexo 15 no trae, a la derecha de lo oficial. «Área» sigue mostrando el sujeto o, sin
 * él, la faena: por eso la faena y el sujeto se separan acá y no se reinterpreta esa columna.
 */
const EXTRA_HEADERS = ["Faena", "Sujeto", "Tipo de instrumento", "Inspección", "Criticidad", "Acción CAPA"]

/** Columnas (desde 1) con fecha real: «Fecha» y «Fecha Ejecución MC». */
const DATE_COLUMNS = [1, 6]
/** «% Cumplimiento»: sigue siendo una fracción con formato de porcentaje. */
const PROGRESS_COLUMN = 8
const COMMENTS_COLUMN = 9

export async function buildInspectionFollowupWorkbook(access: InspectionAccess): Promise<ArrayBuffer> {
  if (!access.permissions.includes("prevention:inspections:export")) throw new Error("Sin permiso para exportar inspecciones.")
  const rows = await listInspectionFollowup(access)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  for (const spec of [
    { name: "SEGUIMENTO INSPECCIONES", rows: rows.filter((row) => row.kind !== "observation") },
    { name: "SEGUIMIENTO OBSERVACIONES", rows: rows.filter((row) => row.kind === "observation") },
  ]) {
    const worksheet = workbook.addWorksheet(spec.name)
    worksheet.addRow([...HEADERS, ...EXTRA_HEADERS])
    for (const row of spec.rows) worksheet.addRow([
      // Fechas de Excel de verdad (antes texto `dd-mm-yyyy`): se ordenan y filtran como fechas.
      excelPlainDate(row.date),
      sanitizeCell(row.area), sanitizeCell(row.deviation), sanitizeCell(row.correctiveMeasure), sanitizeCell(row.responsible),
      excelPlainDate(row.targetDate), sanitizeCell(row.status), row.progress / 100, sanitizeCell(row.comments),
      sanitizeCell(row.worksiteName), sanitizeCell(row.subjectLabel),
      sanitizeCell(INSPECTION_KIND_LABELS[row.kind] ?? row.kind), sanitizeCell(row.runCode),
      sanitizeCell(FINDING_CRITICALITY_LABELS[row.criticality] ?? row.criticality), sanitizeCell(row.actionCode),
    ])
    // Formato celda por celda: asignarlo a la columna no siempre alcanza a las filas ya escritas.
    worksheet.eachRow((excelRow, rowNumber) => {
      if (rowNumber === 1) return
      for (const column of DATE_COLUMNS) excelRow.getCell(column).numFmt = EXCEL_DATE_FORMAT
      excelRow.getCell(PROGRESS_COLUMN).numFmt = "0%"
    })
    worksheet.getRow(1).font = { bold: true }
    worksheet.getColumn(PROGRESS_COLUMN).numFmt = "0%"
    worksheet.getColumn(COMMENTS_COLUMN).alignment = { wrapText: true, vertical: "top" }
    worksheet.views = [{ state: "frozen", ySplit: 1 }]
    // Hasta la última columna nueva: un filtro que se detiene en «Comentarios» dejaría las seis de la derecha fuera.
    worksheet.autoFilter = { from: "A1", to: "O1" }
    worksheet.columns.forEach((column) => { column.width = 22 })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(buffer as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
