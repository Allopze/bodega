import type ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { PERFORMANCE_FAMILY_LABELS, PERFORMANCE_UNIT_LABELS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { parseControlFilters, type ControlFilters } from "@/lib/combustibles/control/filters"
import { todayInChile } from "@/lib/utils"

/**
 * Piezas comunes de las exportaciones del control (G y R): reconstruir los
 * filtros desde los parámetros de la URL, dar formato a una hoja de tabla y
 * cerrar con la hoja de metadatos y la auditoría. Siempre Excel (regla del repo).
 */

export const EXPORT_FAILURE_PERMISSION = "Sin permisos para exportar el control de combustible"

/** Parámetros de URL como los manda el cliente: solo se aceptan cadenas. */
export type ExportParams = Record<string, string>

export function cleanExportParams(params: unknown): ExportParams {
  if (!params || typeof params !== "object") return {}
  const out: ExportParams = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === "string" && value.length <= 200) out[key] = value
  }
  return out
}

export function filtersFromParams(params: unknown, family?: PerformanceFamily): ControlFilters {
  return parseControlFilters(cleanExportParams(params), { family })
}

/** Filtros en lenguaje de usuario para la hoja de metadatos. */
export function describeFilters(filters: ControlFilters): Record<string, unknown> {
  return {
    Año: filters.from || filters.to ? undefined : filters.year,
    Meses: filters.from || filters.to ? undefined : (filters.months.length ? filters.months.join(", ") : "Año completo"),
    Desde: filters.from,
    Hasta: filters.to,
    Faena: filters.worksiteId,
    Mandante: filters.mandanteId,
    Familia: filters.family ? PERFORMANCE_FAMILY_LABELS[filters.family] : undefined,
    Unidad: filters.unit ? PERFORMANCE_UNIT_LABELS[filters.unit] : undefined,
    "Medio de suministro": filters.supplyMediumId,
    Equipo: filters.equipment,
  }
}

export interface SheetColumn {
  header: string
  key: string
  width?: number
  /** Formato numérico de Excel (p. ej. "#,##0.0"). */
  numFmt?: string
}

export function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: SheetColumn[],
  rows: Array<Record<string, unknown>>,
  totalsRow?: Record<string, unknown>,
) {
  const ws = wb.addWorksheet(name)
  ws.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width ?? 16 }))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]
  for (const row of rows) ws.addRow(row)
  if (totalsRow) ws.addRow(totalsRow).font = { bold: true }
  for (const column of columns) if (column.numFmt) ws.getColumn(column.key).numFmt = column.numFmt
  return ws
}

export const LITERS_FORMAT = "#,##0.0"
export const PERFORMANCE_FORMAT = "#,##0.00"

/** Cierra el libro: hoja de metadatos, base64 y auditoría `export`. */
export async function finishExport(input: {
  session: Session
  wb: ExcelJS.Workbook
  entityType: string
  filename: string
  filters: ControlFilters
  rowCount: number
  extra?: Record<string, unknown>
  truncated?: boolean
  rowLimit?: number
}) {
  addExportMetadataSheet(input.wb, input.session, {
    filters: describeFilters(input.filters),
    rowCount: input.rowCount,
    from: input.filters.from ?? null,
    to: input.filters.to ?? null,
  })
  const base64 = await xlsxToBase64(input.wb)
  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: input.entityType,
    entityId: nanoid(),
    worksiteId: input.filters.worksiteId ?? null,
    newState: { rowCount: input.rowCount, filters: describeFilters(input.filters), ...input.extra },
  })
  return {
    ok: true as const,
    data: { base64, filename: `${input.filename}_${todayInChile()}.xlsx`, truncated: input.truncated, rowLimit: input.rowLimit },
  }
}
