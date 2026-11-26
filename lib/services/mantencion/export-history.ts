import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { ACTION_TYPE_LABELS, SPECIALTY_LABELS, type Specialty } from "@/lib/mantencion/action-type"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { filterHistoryRows, HISTORY_MAX_ROWS, HISTORY_SOURCE_LABELS, sortHistoryRows, type HistoryParams } from "@/lib/mantencion/history-view"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData } from "@/lib/reports/export-module/types"
import { formatDate, todayInChile } from "@/lib/utils"
import { viewerFromSession } from "./access"
import { resolveHistoricalWorksiteFilter } from "./historical-import"
import type { ExportOutcome } from "./export-records"
import { loadMaintenanceHistory, type MaintenanceHistoryRow } from "./maintenance-work"

/**
 * «Exportar Excel» del Historial de mantenciones: las mismas filas que muestra la lista con sus filtros (período,
 * faena, equipo, origen, tipo, taller, especialidad y búsqueda), una por trabajo y sin paginar. Los filtros se
 * vuelven a interpretar en el servidor (`parseHistoryParams`): nunca se confía en una lista ya armada por el
 * navegador. El alcance lo pone `loadMaintenanceHistory`, el mismo del Panel. Deja una fila en la bitácora.
 */

export const HISTORY_EXPORT_HEADERS = [
  "Fecha", "Equipo", "Faena", "Origen", "Referencia", "Nº de orden", "Tipo", "Trabajo", "Lectura", "Horas hombre",
  "Ingreso a taller", "Salida de taller", "Días en taller", "En taller", "Taller externo", "Taller o ejecutor externo",
  "Especialidades", "Contrato", "Observación de calidad",
] as const

/** Fechas como celdas de fecha reales (ordenables y filtrables en Excel); lo vacío va vacío, nunca en cero. */
export const HISTORY_EXPORT_FORMATS: Record<number, string> = { 0: EXCEL_DATE_FORMAT, 10: EXCEL_DATE_FORMAT, 11: EXCEL_DATE_FORMAT }

export function historySheetRow(row: MaintenanceHistoryRow): ReportCell[] {
  const { detail } = row
  return [
    excelPlainDate(row.date),
    row.equipmentLabel,
    row.worksiteName ?? "Sin faena",
    HISTORY_SOURCE_LABELS[row.source],
    row.reference || null,
    detail.orderText,
    ACTION_TYPE_LABELS[row.actionType],
    detail.description || null,
    detail.reading,
    row.laborHours,
    excelPlainDate(detail.entryDate),
    excelPlainDate(detail.exitDate),
    row.workshopDays,
    row.inWorkshop ? "Sí" : "No",
    row.external === null ? "No informado" : row.external ? "Sí" : "No",
    detail.responsible,
    detail.specialties.map((key) => SPECIALTY_LABELS[key as Specialty] ?? key).join(", ") || null,
    detail.contract,
    detail.qualityNotes,
  ]
}

export async function exportHistory(input: { session: Session; params: HistoryParams }): Promise<ExportOutcome> {
  const { session, params } = input
  const viewer = viewerFromSession(session)
  // «Exportar» no abre lo que la pantalla no deja ver: sin permiso de lectura del historial (de sus faenas o de todas)
  // no hay libro, aunque el rol tenga `mant:export` y alcance de equipos.
  if (!viewer.permissions.includes("mant:records:view_worksite") && !viewer.permissions.includes("mant:records:view_all")) {
    return { ok: false, message: "Sin permisos" }
  }
  // Igual que la lista: una faena fuera del alcance (o inventada en la URL) se trata como «sin filtro», no como un libro vacío.
  const worksite = await resolveHistoricalWorksiteFilter(viewer, params.worksiteId || undefined)
  const loaded = await loadMaintenanceHistory(viewer, {
    from: params.from,
    to: params.to,
    ...(worksite ? { worksiteId: worksite.id } : {}),
    ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
  })
  const ordered = sortHistoryRows(filterHistoryRows(loaded.rows, params), params.sort, params.dir)
  if (ordered.length === 0) return { ok: false, message: "No hay trabajos para exportar con estos filtros." }
  const truncated = ordered.length > HISTORY_MAX_ROWS
  const kept = truncated ? ordered.slice(0, HISTORY_MAX_ROWS) : ordered

  const filters = {
    faena: worksite?.name,
    equipo: params.vehicleId || undefined,
    origen: params.source ? HISTORY_SOURCE_LABELS[params.source] : undefined,
    tipo: params.type ? ACTION_TYPE_LABELS[params.type] : undefined,
    taller: params.workshop,
    especialidad: params.specialty ? SPECIALTY_LABELS[params.specialty] : undefined,
    busqueda: params.q || undefined,
  }
  // Sólo lo que de verdad se filtró: nada de `null` ni vacíos en «Filtros aplicados» ni en la bitácora.
  const appliedFilters = Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""))
  const report: ReportData = {
    filenameBase: "historial-mantenciones",
    worksheetName: "Historial",
    headers: [...HISTORY_EXPORT_HEADERS],
    rows: kept.map(historySheetRow),
    columnFormats: HISTORY_EXPORT_FORMATS,
    rowLimitApplied: truncated,
  }
  const buffer = await buildXlsxBuffer(report, {
    session,
    filters: appliedFilters,
    // «Todo el historial» no tiene una fecha de inicio que decir: el libro no inventa un «01-01-2000».
    from: params.period === "todo" ? null : params.from,
    to: params.to,
    rowLimit: HISTORY_MAX_ROWS,
    notes: [
      `Mismos trabajos que la lista del Historial de mantenciones: respuestas de formularios hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)}, órdenes de trabajo que entraron a taller y registros firmados de la plataforma desde el ${formatDate(FORMS_CUTOVER_DATE)}; sin anuladas ni filas de prueba.`,
      ...(loaded.includesOrders ? [] : ["Tu perfil no ve todas las órdenes de trabajo de su alcance: este libro no las incluye."]),
    ],
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_history_export",
    entityId: nanoid(),
    newState: { rowCount: kept.length, truncated, filters: appliedFilters },
  })

  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `historial-mantenciones-${todayInChile()}.xlsx`,
      truncated,
      rowLimit: HISTORY_MAX_ROWS,
    },
  }
}
