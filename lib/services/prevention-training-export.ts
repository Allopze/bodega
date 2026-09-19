import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  listTrainingOccurrences,
  type TrainingOccurrenceAccess,
} from "@/lib/services/prevention-training-occurrences"
import {
  PREDEFINED_TRAINING_CATALOG,
  PREDEFINED_TRAINING_CATALOG_VERSION,
  resolvePredefinedTrainingCatalogYear,
} from "@/lib/prevention/training-occurrences-catalog"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

/**
 * Exportación operativa del catálogo anual simplificado. Se mantiene separada
 * del expediente histórico de sesiones para que el usuario no confunda ambos
 * modelos ni reciba columnas que ya no intervienen en este flujo.
 */
export async function buildTrainingOccurrenceExport(
  access: TrainingOccurrenceAccess,
  filters: { year?: number; worksiteId?: string } = {},
): Promise<ReportData> {
  if (!access.permissions.includes("prevention:training:export")) {
    throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
  }

  const year = resolvePredefinedTrainingCatalogYear(filters.year)
  const worksiteId = filters.worksiteId?.trim() || undefined
  const occurrences = await listTrainingOccurrences(access, {
    year,
    worksiteId,
    // A faena seleccionada puede estar inactiva: en ese caso la exportación
    // debe seguir siendo una consulta histórica, aunque el flujo de registro
    // sólo permita operar sobre faenas activas.
    includeInactiveWorksites: true,
  })
  const sheets: ReportSheet[] = [
    sheet(
      "Ocurrencias",
      ["Código", "Actividad", "Tipo", "Faena", "Estado faena", "Año", "Período programado", "Estado", "Marcada el", "Marcada por", "Observación", "Motivo de no aplica", "Evidencias activas", "Actividades PDTP"],
      occurrences.map((row) => [
        safeCell(row.code),
        safeCell(row.title),
        typeLabelForExport(row.itemType),
        safeCell(row.worksiteName),
        row.worksiteActive ? "Activa" : "Inactiva",
        row.year,
        scheduleLabelForExport(row.scheduledMonth, row.scheduledWeek),
        statusLabelForExport(row.status),
        row.completedAt,
        safeCell(row.completedByName),
        safeCell(row.observation),
        safeCell(row.notApplicableReason),
        row.evidence.filter((evidence) => evidence.state === "active").length,
        safeCell(row.pdtpActivityNumbers.join(", ")),
      ]),
    ),
    sheet(
      "Evidencia",
      ["Código", "Actividad", "Faena", "Archivo", "Estado de evidencia", "Tipo", "Tamaño (bytes)", "SHA-256", "Cargada el", "Ruta de almacenamiento"],
      occurrences.flatMap((row) => row.evidence.map((evidence) => [
        safeCell(row.code),
        safeCell(row.title),
        safeCell(row.worksiteName),
        safeCell(evidence.fileName),
        evidenceStateLabelForExport(evidence.state),
        safeCell(evidence.mimeType),
        evidence.fileSizeBytes,
        safeCell(evidence.sha256),
        evidence.uploadedAt,
        safeCell(evidence.storagePath),
      ])),
    ),
    sheet(
      "Catálogo",
      ["Código", "Actividad", "Tipo", "Audiencia", "Fila fuente", "Cronograma", "Actividades PDTP", "Versión"],
      PREDEFINED_TRAINING_CATALOG.map((item) => [
        safeCell(item.code),
        safeCell(item.title),
        typeLabelForExport(item.itemType),
        safeCell(item.audience),
        item.sourceRow,
        safeCell(item.schedule.map((slot) => scheduleLabelForExport(slot.month, slot.week)).join("; ")),
        safeCell(item.pdtpActivityNumbers.join(", ")),
        safeCell(PREDEFINED_TRAINING_CATALOG_VERSION),
      ]),
    ),
  ]

  return {
    filenameBase: `capacitacion_anual_${year}_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: [],
    rows: [],
    sheets,
  }
}

function typeLabelForExport(itemType: string): string {
  return itemType === "campaign" ? "Campaña" : "Curso"
}

/* El `default` silencioso era el riesgo: un estado nuevo salía rotulado como
 * "Pendiente" en el Excel que se le entrega a un fiscalizador. Se nombran los
 * cuatro y el default queda sólo para lo imprevisto. */
function statusLabelForExport(status: string): string {
  if (status === "completed") return "Hecha"
  if (status === "not_completed") return "No hecha"
  if (status === "not_applicable") return "No aplica"
  return "Pendiente"
}

function evidenceStateLabelForExport(state: string): string {
  if (state === "annulled") return "Anulada (conservada)"
  if (state === "replaced") return "Reemplazada (conservada)"
  return "Activa"
}

function scheduleLabelForExport(month: number | null, week: number | null): string {
  if (!month || !week) return "Sin fecha programada"
  return `Mes ${month} · semana ${week}`
}
