import ExcelJS from "exceljs"
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm"
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
import {
  compareByAttention,
  followupStatusOf,
  type FollowupStatus,
  type InspectionFollowupFilter,
  type InspectionFollowupOrder,
} from "@/lib/prevention/inspection-followup-query"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import { formatDateTime, todayInChile } from "@/lib/utils"

// `type` y no `interface`: la fila entra tal cual a `DataTable`, cuyo genérico exige un
// `Record<string, unknown>`, y sólo un alias de tipo objeto cumple esa firma.
export type InspectionFollowupRow = {
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
  /** Situación del hallazgo (sin acción, abierta, vencida, cerrada): ver `followupStatusOf`. */
  followupStatus: FollowupStatus
  /** Última nota de seguimiento de la acción CAPA; `null` sin acción o sin seguimientos. */
  lastFollowup: { at: string; author: string; note: string } | null
}

/**
 * Hallazgos de las inspecciones con su acción CAPA y su avance.
 *
 * `order`: la pantalla pide `attention` (lo que exige acción primero); el Excel del Anexo 15 conserva
 * `chronological`, que es el orden con que se entrega ese formato. `today` es el día de Chile contra el
 * que se decide qué plazo está vencido; se puede fijar para que las pruebas no dependan del reloj.
 *
 * El alcance de faenas se aplica siempre; los filtros sólo acotan dentro de él.
 */
export async function listInspectionFollowup(
  access: InspectionAccess,
  filter: InspectionFollowupFilter = {},
  options: { order?: InspectionFollowupOrder; today?: string } = {},
): Promise<InspectionFollowupRow[]> {
  if (!access.permissions.includes("prevention:inspections:view")) throw new Error("Inspección no encontrada o fuera de alcance.")
  const { order = "chronological", today = todayInChile() } = options
  const responsible = alias(users, "inspection_followup_responsible")
  if (access.scope.mode === "none" || (access.scope.mode === "some" && access.scope.ids.length === 0)) return []
  // `\`, `%` y `_` se escapan para que lo que se escribe en el buscador se busque tal cual.
  const pattern = filter.search ? `%${filter.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null
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
    .where(and(
      access.scope.mode === "all" ? undefined : inArray(preventionInspectionRuns.worksiteId, access.scope.ids),
      filter.worksiteId ? eq(preventionInspectionRuns.worksiteId, filter.worksiteId) : undefined,
      filter.kind ? eq(preventionInspectionTemplates.kind, filter.kind) : undefined,
      pattern ? or(
        ilike(preventionInspectionFindings.description, pattern),
        ilike(preventionInspectionRuns.code, pattern),
        ilike(preventionInspectionRuns.subjectLabel, pattern),
        ilike(worksites.name, pattern),
        ilike(preventionCapaActions.actionDescription, pattern),
        ilike(preventionCapaActions.code, pattern),
        ilike(responsible.name, pattern),
        ilike(preventionCapaActions.responsibleSnapshot, pattern),
      ) : undefined,
    ))
    .orderBy(asc(preventionInspectionRuns.executedAt), asc(preventionInspectionFindings.createdAt))

  // La situación se decide una vez, con la función pura, y sirve al filtro, al orden y a la pantalla.
  const classified = base
    .map((row) => ({
      row,
      followupStatus: followupStatusOf({
        actionId: row.actionId,
        capaStatus: row.status,
        targetDate: row.targetDate,
        findingStatus: row.findingStatus,
      }, today),
    }))
    .filter((item) => !filter.status || item.followupStatus === filter.status)
  if (order === "attention") {
    classified.sort((a, b) => compareByAttention(
      { followupStatus: a.followupStatus, targetDate: a.row.targetDate },
      { followupStatus: b.followupStatus, targetDate: b.row.targetDate },
    ))
  }

  const actionIds = classified.flatMap(({ row }) => row.actionId ? [row.actionId] : [])
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

  return classified.map(({ row, followupStatus }) => {
    const history = row.actionId ? byAction.get(row.actionId) ?? [] : []
    const explicitProgress = [...history].reverse().find((item) => item.progress !== null)?.progress
    const progress = explicitProgress ?? (["verified", "closed"].includes(row.status ?? "") ? 100 : 0)
    const last = history.at(-1)
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
      followupStatus,
      lastFollowup: last ? { at: last.createdAt, author: last.author, note: last.note } : null,
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

/**
 * El libro del Anexo 15. Respeta los filtros de la pantalla (el enlace «Exportar Excel» los lleva en la
 * query) pero NO su orden: el formato oficial se entrega del hallazgo más antiguo al más nuevo, y quien
 * lo consume por posición no tiene por qué ver cambiar el orden según quién lo descargue.
 */
export async function buildInspectionFollowupWorkbook(
  access: InspectionAccess,
  filter: InspectionFollowupFilter = {},
  options: { today?: string } = {},
): Promise<ArrayBuffer> {
  if (!access.permissions.includes("prevention:inspections:export")) throw new Error("Sin permiso para exportar inspecciones.")
  const rows = await listInspectionFollowup(access, filter, { order: "chronological", today: options.today })
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
