import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { preventionInspectionAnswers, preventionInspectionFindings } from "@/db/schema"
import {
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  listInspectionPrograms,
  listInspectionRuns,
  listInspectionTemplates,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

export async function buildInspectionExport(access: InspectionAccess): Promise<ReportData> {
  if (!access.permissions.includes("prevention:inspections:export")) {
    throw new Error("Inspección no encontrada o fuera de alcance.")
  }

  const [runs, templates, programs] = await Promise.all([
    listInspectionRuns(access),
    listInspectionTemplates(access),
    listInspectionPrograms(access),
  ])
  const ids = runs.map((row) => row.run.id)
  const code = new Map(runs.map((row) => [row.run.id, row.run.code]))
  const [answers, findings] = ids.length === 0 ? [[], []] : await Promise.all([
    db.select().from(preventionInspectionAnswers).where(inArray(preventionInspectionAnswers.runId, ids)),
    db.select().from(preventionInspectionFindings).where(inArray(preventionInspectionFindings.runId, ids)),
  ])

  const sheets: ReportSheet[] = [
    sheet(
      "Inspecciones",
      ["Código", "Plantilla", "Tipo", "Faena", "Sujeto", "Estado", "Ejecutada", "Ejecutó", "Revisó", "Cumple", "Regular", "No cumple", "No aplica", "Cumplimiento %", "Comentario de revisión"],
      runs.map((row) => [
        safeCell(row.run.code), safeCell(row.templateName), label(INSPECTION_KIND_LABELS, row.templateKind),
        safeCell(row.worksiteName), safeCell(row.run.subjectLabel), label(INSPECTION_RUN_STATUS_LABELS, row.run.status),
        row.run.executedAt, safeCell(row.run.executedByUserId), safeCell(row.run.reviewedByUserId),
        row.run.conformingCount, row.run.partialCount, row.run.nonConformingCount, row.run.notApplicableCount,
        row.run.compliancePercent === null ? "No calculable" : row.run.compliancePercent,
        safeCell(row.run.reviewComment),
      ]),
    ),
    sheet(
      "Respuestas",
      ["Inspección", "Sección", "Ítem", "Resultado", "Comentario", "Evidencia", "Daño potencial"],
      answers.map((row) => [
        safeCell(code.get(row.runId)), safeCell(row.sectionId), safeCell(row.itemLabel),
        label(INSPECTION_RESULT_LABELS, row.result), safeCell(row.comment), safeCell(row.evidenceReference),
        safeCell(row.danoPotencial),
      ]),
    ),
    sheet(
      "Hallazgos",
      ["Inspección", "Descripción", "Criticidad", "Estado", "Medida inmediata", "CAPA", "Cerrado"],
      findings.map((row) => [
        safeCell(code.get(row.runId)), safeCell(row.description),
        label(FINDING_CRITICALITY_LABELS, row.criticality), label(FINDING_STATUS_LABELS, row.status),
        safeCell(row.immediateMeasure), safeCell(row.capaActionId), row.closedAt,
      ]),
    ),
    sheet(
      "Plantillas",
      ["Código", "Versión", "Nombre", "Tipo", "Estado", "Origen", "Hash", "Marco legal", "Aprobada", "Ítems", "Con daño potencial", "Criticidad calibrada"],
      templates.map((row) => [
        safeCell(row.code), safeCell(row.versionLabel), safeCell(row.name), label(INSPECTION_KIND_LABELS, row.kind),
        row.status, safeCell(row.sourceDefinitionCode), safeCell(row.contentHash), safeCell(row.legalFramework), row.approvedAt,
        row.coverage.totalItems, row.coverage.withDanoPotencial,
        row.coverage.criticalityInert ? "No: todo hallazgo cae a media" : "Sí",
      ]),
    ),
    sheet(
      "Programación",
      ["Plantilla", "Faena", "Frecuencia", "Intervalo (días)", "Próxima", "Responsable", "Activa"],
      programs.map((row) => [
        safeCell(row.templateName), safeCell(row.worksiteName), row.program.frequency,
        row.program.intervalDays, row.program.nextDueOn, safeCell(row.assigneeName),
        row.program.isActive ? "Sí" : "No",
      ]),
    ),
  ]

  return {
    filenameBase: `inspecciones_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}
