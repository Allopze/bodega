import { inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCapaActions,
  preventionInspectionAnswers,
  preventionInspectionFindingEvidence,
  preventionInspectionFindings,
  preventionInspectionRunParticipants,
} from "@/db/schema"
import {
  DANO_POTENCIAL_LABELS,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_FREQUENCY_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_PROVENANCE_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  inspectionResultLabel,
  inspectionTemplateStatusLabel,
} from "@/lib/prevention/inspections"
import { formatInspectionAnswerValue } from "@/lib/prevention/inspection-answer-format"
import { inspectionSubjectTypeLabel } from "@/lib/prevention/inspection-list-query"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import type { ChecklistDefinition, FieldKind, SelectOption } from "@/lib/sst/types"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import {
  EXCEL_DATE_FORMAT,
  EXCEL_DATETIME_FORMAT,
  excelDateTime,
  excelPlainDate,
} from "@/lib/reports/excel-dates"
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
import { formatDate, todayInChile } from "@/lib/utils"
import { eppInspectionItemKind } from "@/lib/prevention/epp-inspection-rows"

/**
 * `dateColumns` nombra la columna y no su posición: el formato viaja con el
 * encabezado y un reordenamiento no lo deja aplicado a otra columna. Un nombre
 * que no existe lanza, así que una errata se ve en el test y no en el libro.
 */
function sheet(
  worksheetName: string,
  headers: string[],
  rows: ReportCell[][],
  dateColumns: Record<string, string> = {},
): ReportSheet {
  const columnFormats: Record<number, string> = {}
  for (const [header, format] of Object.entries(dateColumns)) {
    const index = headers.indexOf(header)
    if (index === -1) throw new Error(`La hoja «${worksheetName}» no tiene la columna «${header}».`)
    columnFormats[index] = format
  }
  return { worksheetName, headers, rows, ...(Object.keys(columnFormats).length > 0 ? { columnFormats } : {}) }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

/**
 * De dónde viene la plantilla, como lo lee una persona: el nombre con que el catálogo conoce su
 * definición («Caminata de seguridad»), no el código interno (`caminata_seguridad`). Una definición
 * que ya no está en el catálogo no tiene nombre que mostrar, así que cae a su código sin guiones bajos.
 */
function definitionOriginLabel(code: string | null | undefined) {
  if (!code) return ""
  const title = CHECKLIST_DEFINITIONS[code]?.title
  if (title) return title
  const spaced = code.replace(/_/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const VIEW_LABELS: Record<NonNullable<InspectionListFilters["view"]>, string> = {
  pending_review: "Pendientes de revisión",
  open_findings: "Con hallazgos abiertos",
  critical: "Con hallazgo grave",
  overdue: "Vencidas",
}

/**
 * Los filtros del export en palabras de la pantalla, para la hoja «Metadatos»
 * (REP-002). Sin esto el libro decía `{"status":"completed","assignedToUserId":"…"}`:
 * quien lo recibía meses después no podía saber con qué alcance se generó.
 *
 * `names` lleva los nombres de la faena y del responsable, que el filtro trae
 * como id; sin ellos se muestra el id. Salen de las propias filas exportadas y
 * no de una consulta aparte, así que nunca nombran algo fuera de alcance.
 */
export function inspectionExportFilterSummary(
  filter: InspectionListFilters,
  names: { worksiteName?: string | null; assigneeName?: string | null } = {},
): Record<string, string> {
  const summary: Record<string, string> = {}
  if (filter.kinds?.length) summary["Tipo"] = filter.kinds.map((kind) => label(INSPECTION_KIND_LABELS, kind)).join(", ")
  if (filter.status) summary["Estado"] = label(INSPECTION_RUN_STATUS_LABELS, filter.status)
  if (filter.view) summary["Vista"] = VIEW_LABELS[filter.view] ?? filter.view
  if (filter.worksiteId) summary["Faena"] = names.worksiteName || filter.worksiteId
  if (filter.assignedToUserId) summary["Responsable"] = names.assigneeName || filter.assignedToUserId
  if (filter.search?.trim()) summary["Búsqueda"] = filter.search.trim()
  if (filter.executedFrom) summary["Ejecutadas desde"] = formatDate(filter.executedFrom)
  if (filter.executedTo) summary["Ejecutadas hasta"] = formatDate(filter.executedTo)
  // Un objeto vacío se escribía como `{}` en «Filtros aplicados».
  return Object.keys(summary).length > 0 ? summary : { Filtros: "Ninguno" }
}

/** `ReportData` más lo que la ruta necesita para la hoja «Metadatos». */
export type InspectionExportReport = ReportData & { filterSummary: Record<string, string> }

/**
 * `filter` acota el export al mismo tipo de instrumento que la pantalla. Sin
 * esto, exportar desde una bandeja filtrada a auditorías bajaba el universo
 * completo con el mismo nombre de archivo: dos Excel distintos indistinguibles.
 */
export async function buildInspectionExport(
  access: InspectionAccess,
  filter: InspectionListFilters = {},
): Promise<InspectionExportReport> {
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
  // `options` viaja con el ítem para que «Valor» muestre la etiqueta de la opción
  // elegida y no su valor almacenado (`pqs` en vez de «PQS (Polvo Químico Seco)»).
  type ItemContext = { sectionTitle: string; kind?: FieldKind; options?: SelectOption[] }
  const itemContext = new Map<string, ItemContext>()
  const sectionTitle = new Map<string, string>()
  for (const row of runs) {
    const definition = (row.templateSnapshot ?? null) as ChecklistDefinition | null
    for (const section of definition?.sections ?? []) {
      sectionTitle.set(`${row.run.templateId}::${section.id}`, section.title)
      for (const item of section.items) {
        itemContext.set(`${row.run.templateId}::${section.id}::${item.id}`, {
          sectionTitle: section.title,
          kind: item.kind,
          options: item.options,
        })
      }
    }
  }
  const templateOfRun = new Map(runs.map((row) => [row.run.id, row.run.templateId]))
  const contextOf = (runId: string, sectionId: string, itemId: string): ItemContext | undefined => {
    const templateId = templateOfRun.get(runId) ?? ""
    const found = itemContext.get(`${templateId}::${sectionId}::${itemId}`)
    if (found) return found
    // Las filas de la inspección de EPP salen de la bodega de la faena y no
    // están en el snapshot de la plantilla; su escala se lee del sufijo.
    const kind = eppInspectionItemKind(sectionId, itemId)
    const title = sectionTitle.get(`${templateId}::${sectionId}`)
    return kind && title ? { sectionTitle: title, kind } : undefined
  }
  const [answers, findings, participants] = ids.length === 0 ? [[], [], []] : await Promise.all([
    db.select().from(preventionInspectionAnswers).where(inArray(preventionInspectionAnswers.runId, ids)),
    db.select().from(preventionInspectionFindings).where(inArray(preventionInspectionFindings.runId, ids)),
    db.select().from(preventionInspectionRunParticipants).where(inArray(preventionInspectionRunParticipants.runId, ids)),
  ])
  // El hallazgo guarda el id de la CAPA y nadie lee un id: una sola consulta
  // `id → código` para todo el libro, no una por fila.
  const capaIds = [...new Set(findings.flatMap((row) => (row.capaActionId ? [row.capaActionId] : [])))]
  const [findingEvidence, capaRows] = await Promise.all([
    findings.length === 0 ? [] : db.select({
      findingId: preventionInspectionFindingEvidence.findingId,
    }).from(preventionInspectionFindingEvidence)
      .where(inArray(preventionInspectionFindingEvidence.findingId, findings.map((row) => row.id))),
    capaIds.length === 0 ? [] : db.select({
      id: preventionCapaActions.id,
      code: preventionCapaActions.code,
    }).from(preventionCapaActions)
      .where(inArray(preventionCapaActions.id, capaIds)),
  ])
  const capaCode = new Map(capaRows.map((row) => [row.id, row.code]))
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
      // Los cinco últimos son nuevos y van AL FINAL: quien ya consume el libro por
      // posición de columna no los ve moverse. Los cuatro agregados dejaron de
      // llamarse «Cumple / Regular / No cumple / No aplica» porque mezclaban
      // escalas: en un Anexo 13 «Cumple» son los ítems «Bueno», y «No aplica»
      // suma también los «No tiene» (`summarizeCompliance`).
      ["Código", "Plantilla", "Tipo", "Origen", "Faena", "Sujeto", "Estado", "Ejecutada", "Ejecutó", "Revisó", "Ítems conformes", "Ítems regulares", "Ítems no conformes", "Ítems no evaluados (No aplica / No tiene)", "Resultado oficial %", "Resultado normalizado %", "Procedencia documental", "Revisión documental", "Checksum documental", "Hash digital", "Participantes", "Comentario de revisión", "Responsable", "Programada para", "Revisada", "Hallazgos abiertos", "Hallazgos graves abiertos"],
      runs.map((row) => [
        safeCell(row.run.code), safeCell(row.templateName), label(INSPECTION_KIND_LABELS, row.templateKind),
        label(INSPECTION_ORIGIN_LABELS, row.run.origin),
        safeCell(row.worksiteName), safeCell(row.run.subjectLabel), label(INSPECTION_RUN_STATUS_LABELS, row.run.status),
        // Fecha real en hora de Chile, no el texto UTC de la columna: no se podía
        // ordenar ni filtrar, y mostraba 18:34 donde la pantalla dice 15:34.
        excelDateTime(row.run.executedAt),
        // A-07: antes iban los IDs internos de usuario.
        safeCell(row.executorName), safeCell(row.reviewerName),
        row.run.conformingCount, row.run.partialCount, row.run.nonConformingCount, row.run.notApplicableCount,
        row.run.officialComplianceBasisPoints === null ? "Sin fórmula documental" : row.run.officialComplianceBasisPoints / 100,
        row.run.normalizedComplianceBasisPoints === null ? "No calculable" : row.run.normalizedComplianceBasisPoints / 100,
        label(INSPECTION_PROVENANCE_LABELS, row.templateProvenanceKind),
        safeCell((row.templateSourceSnapshot as { revision?: string } | null)?.revision),
        safeCell((row.templateSourceSnapshot as { checksumSha256?: string } | null)?.checksumSha256),
        safeCell(row.templateContentHash),
        safeCell((participantNames.get(row.run.id) ?? []).join("; ")),
        safeCell(row.run.reviewComment),
        safeCell(row.assigneeName), excelPlainDate(row.run.scheduledFor), excelDateTime(row.run.reviewedAt),
        row.openFindings, row.criticalFindings,
      ]),
      { Ejecutada: EXCEL_DATETIME_FORMAT, "Programada para": EXCEL_DATE_FORMAT, Revisada: EXCEL_DATETIME_FORMAT },
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
        // juicio de conformidad (B-08). Se lee como lo lee la pantalla: la
        // etiqueta de la opción elegida y las fechas como `dd-mm-yyyy`.
        safeCell(formatInspectionAnswerValue(context, row.value, "")),
        safeCell(row.comment), safeCell(row.evidenceReference),
        label(DANO_POTENCIAL_LABELS, row.danoPotencial),
        ]
      }),
    ),
    sheet(
      "Hallazgos",
      ["Inspección", "Descripción", "Daño potencial narrativo", "Clasificación de daño", "Normativa aplicable", "Criticidad", "Estado", "Medida preventiva", "CAPA", "Evidencias", "Cerrado"],
      findings.map((row) => [
        safeCell(code.get(row.runId)), safeCell(row.description),
        safeCell(row.potentialDamageDescription), label(DANO_POTENCIAL_LABELS, row.danoPotencial), safeCell(row.applicableLaw),
        label(FINDING_CRITICALITY_LABELS, row.criticality), label(FINDING_STATUS_LABELS, row.status),
        // El código de la acción (CAPA-…), que es lo que se busca en /prevencion/capa;
        // el id interno no le sirve a nadie.
        safeCell(row.immediateMeasure), safeCell(row.capaActionId ? capaCode.get(row.capaActionId) : null),
        evidenceCount.get(row.id) ?? 0, excelDateTime(row.closedAt),
      ]),
      { Cerrado: EXCEL_DATETIME_FORMAT },
    ),
    sheet(
      "Plantillas",
      ["Código", "Versión", "Nombre", "Tipo", "Estado", "Origen", "Hash", "Deriva del catálogo", "Marco legal", "Aprobada", "Ítems", "Con daño potencial", "Criticidad calibrada", "Procedencia"],
      templates.map((row) => [
        safeCell(row.code), safeCell(row.versionLabel), safeCell(row.name), label(INSPECTION_KIND_LABELS, row.kind),
        // «Retirada» y no «Reemplazada»: una plantilla retirada no tiene versión que la reemplace.
        inspectionTemplateStatusLabel(row.status, row.supersededByTemplateId),
        safeCell(definitionOriginLabel(row.sourceDefinitionCode)), safeCell(row.contentHash),
        row.definitionMissing
          ? "Definición retirada del catálogo"
          : row.definitionDrifted ? "Sí: el código difiere del snapshot" : "No",
        safeCell(row.legalFramework), excelDateTime(row.approvedAt),
        row.coverage.totalItems, row.coverage.withDanoPotencial,
        row.coverage.criticalityInert ? "No: todo hallazgo cae a media" : "Sí",
        label(INSPECTION_PROVENANCE_LABELS, row.provenanceKind),
      ]),
      { Aprobada: EXCEL_DATETIME_FORMAT },
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
      ["Plantilla", "Faena", "Frecuencia", "Intervalo (días)", "Próxima", "Responsable", "Activa", "Plantilla vigente", "Sujeto"],
      programs.map((row) => [
        safeCell(row.templateName), safeCell(row.worksiteName), label(INSPECTION_FREQUENCY_LABELS, row.program.frequency),
        // `nextDueOn` es una fecha calendario: sale como fecha de Excel, sin hora ni desfase.
        row.program.intervalDays, excelPlainDate(row.program.nextDueOn), safeCell(row.assigneeName),
        row.program.isActive ? "Sí" : "No",
        // I-04: el Excel es artefacto de evidencia; repetía la misma "Activa: Sí"
        // aunque la plantilla ya no pueda producir inspecciones.
        row.templateStatus === "approved" ? "Sí" : "No — no producirá inspecciones",
        // El recurso, equipo o contenedor concreto; sin él, el tipo declarado.
        safeCell(row.subjectLabel ?? (row.program.subjectType ? inspectionSubjectTypeLabel(row.program.subjectType) : "")),
      ]),
      { Próxima: EXCEL_DATE_FORMAT },
    ),
  ]

  const scoped = Boolean(
    filter.status || filter.worksiteId || filter.search || filter.view
    || filter.assignedToUserId || filter.executedFrom || filter.executedTo,
  )

  return {
    // El nombre declara el alcance: un export acotado y uno completo no pueden
    // llamarse igual. Responsable y rango de fechas también acotan: sin ellos un
    // Excel de un solo prevencionista se llamaba igual que el del universo.
    filenameBase: `inspecciones${filter.kinds?.length ? `_${filter.kinds.join("-")}` : ""}${scoped ? "_filtradas" : ""}_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    /* Vacías a propósito: `sheets` son hojas ADICIONALES a la primaria, no un
     * reemplazo. Copiar acá la primera de `sheets` venía de cuando el builder
     * descartaba la primaria si el reporte traía `sheets`; corregido aquel
     * contrato, la duplicación se volvió visible y el libro salía con la
     * primera hoja dos veces ("Expediente" y "Expediente (2)"). */
    headers: [],
    rows: [],
    sheets,
    // Los nombres salen de las filas ya filtradas por alcance: ver `inspectionExportFilterSummary`.
    filterSummary: inspectionExportFilterSummary(filter, {
      worksiteName: filter.worksiteId ? runs.find((row) => row.run.worksiteId === filter.worksiteId)?.worksiteName : null,
      assigneeName: filter.assignedToUserId ? runs.find((row) => row.run.assignedToUserId === filter.assignedToUserId)?.assigneeName : null,
    }),
  }
}
