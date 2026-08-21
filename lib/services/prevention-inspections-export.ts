import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { preventionInspectionAnswers, preventionInspectionFindings } from "@/db/schema"
import {
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  listAllInspectionRunsForExport,
  listInspectionPrograms,
  listInspectionTemplates,
  summarizeInspectionTimelyClosure,
  summarizeInspectionTrends,
  type InspectionAccess,
  type InspectionKindFilter,
} from "@/lib/services/prevention-inspections"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

/**
 * `filter` acota el export al mismo tipo de instrumento que la pantalla. Sin
 * esto, exportar desde una bandeja filtrada a auditorías bajaba el universo
 * completo con el mismo nombre de archivo: dos Excel distintos indistinguibles.
 */
export async function buildInspectionExport(
  access: InspectionAccess,
  filter: InspectionKindFilter = {},
): Promise<ReportData> {
  if (!access.permissions.includes("prevention:inspections:export")) {
    throw new Error("Inspección no encontrada o fuera de alcance.")
  }

  // C-09: el export NO usa la consulta paginada. Exportar la primera página
  // sería un fallo silencioso de integridad, y hasta ahora truncaba a 500 filas
  // sin avisar.
  const [runs, templates, programs, timely, trends] = await Promise.all([
    listAllInspectionRunsForExport(access, filter),
    listInspectionTemplates(access, filter),
    listInspectionPrograms(access, filter),
    summarizeInspectionTimelyClosure(access, filter),
    summarizeInspectionTrends(access, filter),
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
      ["Código", "Plantilla", "Tipo", "Origen", "Faena", "Sujeto", "Estado", "Ejecutada", "Ejecutó", "Revisó", "Cumple", "Regular", "No cumple", "No aplica", "Cumplimiento %", "Comentario de revisión"],
      runs.map((row) => [
        safeCell(row.run.code), safeCell(row.templateName), label(INSPECTION_KIND_LABELS, row.templateKind),
        label(INSPECTION_ORIGIN_LABELS, row.run.origin),
        safeCell(row.worksiteName), safeCell(row.run.subjectLabel), label(INSPECTION_RUN_STATUS_LABELS, row.run.status),
        // A-07: antes iban los IDs internos de usuario.
        row.run.executedAt, safeCell(row.executorName), safeCell(row.reviewerName),
        row.run.conformingCount, row.run.partialCount, row.run.nonConformingCount, row.run.notApplicableCount,
        row.run.compliancePercent === null ? "No calculable" : row.run.compliancePercent,
        safeCell(row.run.reviewComment),
      ]),
    ),
    sheet(
      "Respuestas",
      ["Inspección", "Sección", "Ítem", "Resultado", "Valor", "Comentario", "Evidencia", "Daño potencial"],
      answers.map((row) => [
        safeCell(code.get(row.runId)), safeCell(row.sectionId), safeCell(row.itemLabel),
        label(INSPECTION_RESULT_LABELS, row.result),
        // Los ítems que no puntúan responden con su contenido, no con un
        // juicio de conformidad (B-08).
        safeCell(row.value),
        safeCell(row.comment), safeCell(row.evidenceReference),
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
      ["Código", "Versión", "Nombre", "Tipo", "Estado", "Origen", "Hash", "Deriva del catálogo", "Marco legal", "Aprobada", "Ítems", "Con daño potencial", "Criticidad calibrada"],
      templates.map((row) => [
        safeCell(row.code), safeCell(row.versionLabel), safeCell(row.name), label(INSPECTION_KIND_LABELS, row.kind),
        row.status, safeCell(row.sourceDefinitionCode), safeCell(row.contentHash),
        row.definitionMissing
          ? "Definición retirada del catálogo"
          : row.definitionDrifted ? "Sí: el código difiere del snapshot" : "No",
        safeCell(row.legalFramework), row.approvedAt,
        row.coverage.totalItems, row.coverage.withDanoPotencial,
        row.coverage.criticalityInert ? "No: todo hallazgo cae a media" : "Sí",
      ]),
    ),
    sheet(
      "Cierre oportuno",
      ["Con plazo comprometido", "Cerrados a tiempo", "Cerrados tarde", "Abiertos vencidos", "Abiertos en plazo", "% cierre oportuno"],
      [[
        timely.tracked, timely.closedOnTime, timely.closedLate, timely.overdue, timely.openOnTime,
        timely.timelyPct === null ? "Sin datos juzgables" : timely.timelyPct,
      ]],
    ),
    sheet(
      "Tendencias",
      ["Mes", "Ejecutadas", "Cumplimiento promedio %", "No cumple", "Hallazgos abiertos"],
      trends.map((row) => [
        safeCell(row.month), row.executed,
        row.avgCompliance === null ? "No calculable" : row.avgCompliance,
        row.nonConforming, row.openFindings,
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
    // El nombre declara el alcance: un export acotado y uno completo no pueden
    // llamarse igual.
    filenameBase: `inspecciones${filter.kinds?.length ? `_${filter.kinds.join("-")}` : ""}_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}
