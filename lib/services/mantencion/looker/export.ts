import type { Session } from "next-auth"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { viewerFromSession } from "../access"
import { loadCorrectiveRows } from "./corrective"
import {
  correctiveNotes, correctiveSheet, driversSheet, equipmentSeriesSheet, monthlyWorkSheet,
} from "./export-corrective"
import { EXPORT_TAB_SHORT, filtersSheet, UNIT_LABEL, type ExportTab } from "./export-filters"
import { planningNotes, planningSheet } from "./export-planning"
import {
  checklistMatrixSheet, complianceByMonthSheet, complianceByPlateSheet, complianceByWorksiteMechanicSheet,
  matrixChecksSheet, preventiveNotes,
} from "./export-preventive"
import { pickFilterParams } from "./filters"
import { loadLookerContext } from "./resolve"
import { loadCorrectiveTabData, loadPlanningTabData, loadPreventiveTabData } from "./work-data"

/**
 * «Exportar Excel» de Planificación, Correctivo y Preventivo: arma el libro EN EL SERVIDOR, volviendo a consultar con
 * los mismos filtros de la URL y el alcance de quien exporta. Nada viaja desde el navegador salvo los parámetros
 * de la URL: `loadLookerContext` los valida contra el alcance (una faena, un equipo, una OT o una pauta ajenos se
 * ignoran) y cada consulta vuelve a aplicar su visibilidad por faena. Es lo mismo que hace la página, con los
 * mismos cargadores (`work-data.ts`); sólo cambia que aquí las tablas no se paginan.
 */

/** Tope de filas de una hoja: sobre eso el período es demasiado ancho para una hoja útil. */
export const LOOKER_EXPORT_MAX_ROWS = 20_000
/** Pautas de la matriz de checklist que entran al libro (la pantalla muestra las últimas 8). */
export const LOOKER_EXPORT_MATRIX_CHECKS = 60

type Raw = Record<string, string | string[] | undefined>

export interface LookerExportInput {
  tab: ExportTab
  /** Parámetros de la URL; sólo valen los que mueven la pestaña (`pickFilterParams`). */
  params: Raw
  /** Para probar: el día de hoy, que corta el período. */
  today?: string
  maxRows?: number
}

export interface LookerExportResult {
  base64: string
  title: string
  /** Hojas de datos (sin «Filtros» ni «Metadatos») y sus filas, para la auditoría. */
  sheets: Array<{ title: string; rowCount: number }>
  /** Alguna hoja se cortó en el tope de filas. */
  truncated: boolean
}

/** Corta una hoja en el tope y deja el aviso para «Filtros». */
function capSheet(sheet: ReportSheet, maxRows: number, notes: string[]): ReportSheet {
  if (sheet.rows.length <= maxRows) return sheet
  notes.push(`«${sheet.worksheetName}»: la hoja se cortó en ${maxRows} de ${sheet.rows.length} filas; acota el período.`)
  return { ...sheet, rows: sheet.rows.slice(0, maxRows) }
}

export async function buildLookerExport(session: Session, input: LookerExportInput): Promise<LookerExportResult> {
  const { tab } = input
  const today = input.today ?? todayInChile()
  const maxRows = input.maxRows ?? LOOKER_EXPORT_MAX_ROWS
  const viewer = viewerFromSession(session)
  const params = pickFilterParams(input.params)
  const context = await loadLookerContext(viewer, { ...params, pestana: tab }, today)
  const { filters, cross } = context

  const truncation: string[] = []
  let sheets: ReportSheet[]
  let readingNotes: string[]

  const unit = filters.unit
  if (tab === "planificacion") {
    const data = await loadPlanningTabData(viewer, context)
    sheets = [capSheet(planningSheet(data.rows, unit), maxRows, truncation)]
    readingNotes = planningNotes(cross, unit)
  } else if (tab === "correctivo") {
    const data = await loadCorrectiveTabData(
      viewer,
      context,
      () => loadCorrectiveRows(viewer, filters, cross, { limit: maxRows }),
      { seriesLimit: Number.POSITIVE_INFINITY },
    )
    const corrective = correctiveSheet(data.rows.rows, unit)
    if (data.rows.total > data.rows.rows.length) {
      truncation.push(`«${corrective.worksheetName}»: la hoja se cortó en ${data.rows.rows.length} de ${data.rows.total} trabajos; acota el período.`)
    }
    sheets = [
      corrective,
      ...[
        driversSheet(data.drivers),
        equipmentSeriesSheet(data.series),
        monthlyWorkSheet(data.monthly),
      ].map((sheet) => capSheet(sheet, maxRows, truncation)),
    ]
    readingNotes = correctiveNotes(unit)
  } else {
    const data = await loadPreventiveTabData(viewer, context, { matrixLimit: LOOKER_EXPORT_MATRIX_CHECKS })
    sheets = [
      ...[
        complianceByPlateSheet(data.byPlate.byPlate),
        complianceByMonthSheet(data.monthly.byMonth),
        complianceByWorksiteMechanicSheet(data.byWorksite.byWorksiteMechanic),
      ].map((sheet) => capSheet(sheet, maxRows, truncation)),
      checklistMatrixSheet(data.matrix),
      matrixChecksSheet(data.matrix),
    ]
    readingNotes = preventiveNotes(unit, data.matrix, LOOKER_EXPORT_MATRIX_CHECKS)
  }

  const title = `Panel de mantención · ${EXPORT_TAB_SHORT[tab]} · ${UNIT_LABEL[unit]}`
  const [primary, ...rest] = [...sheets, filtersSheet({ tab, context, notes: [...truncation, ...readingNotes] })]
  if (!primary) throw new Error("Un libro del Panel necesita al menos una hoja")
  const buffer = await buildXlsxBuffer(
    {
      filenameBase: title,
      worksheetName: primary.worksheetName,
      headers: primary.headers,
      rows: primary.rows,
      ...(primary.columnFormats ? { columnFormats: primary.columnFormats } : {}),
      sheets: rest,
    },
    // «Metadatos» (quién, cuándo, alcance de faena y período). Los filtros con sus nombres van en «Filtros».
    { session, filters: { tablero: "Panel de mantención", pestana: EXPORT_TAB_SHORT[tab], unidad: UNIT_LABEL[unit] }, from: filters.from, to: filters.to },
  )
  return {
    base64: Buffer.from(buffer).toString("base64"),
    title,
    sheets: sheets.map((sheet) => ({ title: sheet.worksheetName, rowCount: sheet.rows.length })),
    truncated: truncation.length > 0,
  }
}
