import { inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionInspectionAnswers,
  preventionInspectionFindingEvidence,
  preventionInspectionFindings,
  preventionInspectionRunParticipants,
} from "@/db/schema"
import {
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  inspectionResultLabel,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition, FieldKind } from "@/lib/sst/types"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  listAllInspectionRunsForExport,
  listInspectionPrograms,
  listInspectionTemplates,
  summarizeInspectionTimelyClosure,
  summarizeInspectionTrends,
  type InspectionAccess,
  type InspectionListFilters,
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
  filter: InspectionListFilters = {},
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

  /**
   * Título y escala de cada ítem, resueltos desde el snapshot congelado de la
   * plantilla de cada inspección.
   *
   * La hoja de respuestas itera filas de `prevention_inspection_answers`, que
   * no llevan ni el `kind` ni el nombre de la sección: volcaba el `sectionId`
   * crudo y traducía el resultado con el mapa global, de modo que un Anexo 13
   * salía como "Cumple" donde el papel firmado dice "Bueno" (INS-07/INS-13).
   */
  const itemContext = new Map<string, { sectionTitle: string; kind?: FieldKind }>()
  for (const row of runs) {
    const definition = (row.templateSnapshot ?? null) as ChecklistDefinition | null
    for (const section of definition?.sections ?? []) {
      for (const item of section.items) {
        itemContext.set(`${row.run.templateId}::${section.id}::${item.id}`, {
          sectionTitle: section.title,
          kind: item.kind,
        })
      }
    }
  }
  const templateOfRun = new Map(runs.map((row) => [row.run.id, row.run.templateId]))
  const contextOf = (runId: string, sectionId: string, itemId: string) =>
    itemContext.get(`${templateOfRun.get(runId) ?? ""}::${sectionId}::${itemId}`)
  const [answers, findings, participants] = ids.length === 0 ? [[], [], []] : await Promise.all([
    db.select().from(preventionInspectionAnswers).where(inArray(preventionInspectionAnswers.runId, ids)),
    db.select().from(preventionInspectionFindings).where(inArray(preventionInspectionFindings.runId, ids)),
    db.select().from(preventionInspectionRunParticipants).where(inArray(preventionInspectionRunParticipants.runId, ids)),
  ])
  const findingEvidence = findings.length === 0 ? [] : await db.select({
    findingId: preventionInspectionFindingEvidence.findingId,
  }).from(preventionInspectionFindingEvidence)
    .where(inArray(preventionInspectionFindingEvidence.findingId, findings.map((row) => row.id)))
  const evidenceCount = new Map<string, number>()
  for (const row of findingEvidence) evidenceCount.set(row.findingId, (evidenceCount.get(row.findingId) ?? 0) + 1)
  const participantNames = new Map<string, string[]>()
  for (const participant of participants) {
    const list = participantNames.get(participant.runId) ?? []
    list.push(`${participant.name} (${participant.position})`)
    participantNames.set(participant.runId, list)
  }

  const sheets: ReportSheet[] = [
    sheet(
      "Inspecciones",
      ["Código", "Plantilla", "Tipo", "Origen", "Faena", "Sujeto", "Estado", "Ejecutada", "Ejecutó", "Revisó", "Cumple", "Regular", "No cumple", "No aplica", "Resultado oficial %", "Resultado normalizado %", "Procedencia documental", "Revisión documental", "Checksum documental", "Hash digital", "Participantes", "Comentario de revisión"],
      runs.map((row) => [
        safeCell(row.run.code), safeCell(row.templateName), label(INSPECTION_KIND_LABELS, row.templateKind),
        label(INSPECTION_ORIGIN_LABELS, row.run.origin),
        safeCell(row.worksiteName), safeCell(row.run.subjectLabel), label(INSPECTION_RUN_STATUS_LABELS, row.run.status),
        // A-07: antes iban los IDs internos de usuario.
        row.run.executedAt, safeCell(row.executorName), safeCell(row.reviewerName),
        row.run.conformingCount, row.run.partialCount, row.run.nonConformingCount, row.run.notApplicableCount,
        row.run.officialComplianceBasisPoints === null ? "Sin fórmula documental" : row.run.officialComplianceBasisPoints / 100,
        row.run.normalizedComplianceBasisPoints === null ? "No calculable" : row.run.normalizedComplianceBasisPoints / 100,
        row.templateProvenanceKind,
        safeCell((row.templateSourceSnapshot as { revision?: string } | null)?.revision),
        safeCell((row.templateSourceSnapshot as { checksumSha256?: string } | null)?.checksumSha256),
        safeCell(row.templateContentHash),
        safeCell((participantNames.get(row.run.id) ?? []).join("; ")),
        safeCell(row.run.reviewComment),
      ]),
    ),
    sheet(
      "Respuestas",
      ["Inspección", "Sección", "Ítem", "Resultado", "Valor", "Comentario", "Evidencia", "Daño potencial"],
      answers.map((row) => {
        const context = contextOf(row.runId, row.sectionId, row.itemId)
        return [
        safeCell(code.get(row.runId)), safeCell(context?.sectionTitle ?? row.sectionId), safeCell(row.itemLabel),
        inspectionResultLabel(context?.kind, row.result),
        // Los ítems que no puntúan responden con su contenido, no con un
        // juicio de conformidad (B-08).
        safeCell(row.value),
        safeCell(row.comment), safeCell(row.evidenceReference),
        safeCell(row.danoPotencial),
        ]
      }),
    ),
    sheet(
      "Hallazgos",
      ["Inspección", "Descripción", "Daño potencial narrativo", "Clasificación de daño", "Normativa aplicable", "Criticidad", "Estado", "Medida preventiva", "CAPA", "Evidencias", "Cerrado"],
      findings.map((row) => [
        safeCell(code.get(row.runId)), safeCell(row.description),
        safeCell(row.potentialDamageDescription), safeCell(row.danoPotencial), safeCell(row.applicableLaw),
        label(FINDING_CRITICALITY_LABELS, row.criticality), label(FINDING_STATUS_LABELS, row.status),
        safeCell(row.immediateMeasure), safeCell(row.capaActionId), evidenceCount.get(row.id) ?? 0, row.closedAt,
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
      ["Plantilla", "Faena", "Frecuencia", "Intervalo (días)", "Próxima", "Responsable", "Activa", "Plantilla vigente"],
      programs.map((row) => [
        safeCell(row.templateName), safeCell(row.worksiteName), row.program.frequency,
        row.program.intervalDays, row.program.nextDueOn, safeCell(row.assigneeName),
        row.program.isActive ? "Sí" : "No",
        // I-04: el Excel es artefacto de evidencia; repetía la misma "Activa: Sí"
        // aunque la plantilla ya no pueda producir inspecciones.
        row.templateStatus === "approved" ? "Sí" : "No — no producirá inspecciones",
      ]),
    ),
  ]

  return {
    // El nombre declara el alcance: un export acotado y uno completo no pueden
    // llamarse igual.
    filenameBase: `inspecciones${filter.kinds?.length ? `_${filter.kinds.join("-")}` : ""}${filter.status || filter.worksiteId || filter.search || filter.view ? "_filtradas" : ""}_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    /* Vacías a propósito: `sheets` son hojas ADICIONALES a la primaria, no un
     * reemplazo. Copiar acá la primera de `sheets` venía de cuando el builder
     * descartaba la primaria si el reporte traía `sheets`; corregido aquel
     * contrato, la duplicación se volvió visible y el libro salía con la
     * primera hoja dos veces ("Expediente" y "Expediente (2)"). */
    headers: [],
    rows: [],
    sheets,
  }
}
