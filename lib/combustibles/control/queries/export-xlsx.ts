import type ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelMandantes, fuelSupplyMedia, worksites } from "@/db/schema"
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

/** Nombres de lo que los filtros eligen por identificador, para que la hoja de metadatos hable en palabras. */
export interface FilterNames {
  worksite?: string
  mandante?: string
  medium?: string
}

/**
 * Busca el nombre de la faena, el mandante y el medio de suministro elegidos.
 * Un nombre que no se pueda resolver queda sin él (la hoja muestra el
 * identificador): un metadato nunca debe tumbar una exportación.
 */
export async function resolveFilterNames(filters: ControlFilters): Promise<FilterNames> {
  async function nameOf(lookup: () => Promise<Array<{ name: string }>>): Promise<string | undefined> {
    try { return (await lookup())[0]?.name } catch { return undefined }
  }
  const [worksite, mandante, medium] = await Promise.all([
    filters.worksiteId ? nameOf(() => db.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, filters.worksiteId!)).limit(1)) : undefined,
    filters.mandanteId ? nameOf(() => db.select({ name: fuelMandantes.name }).from(fuelMandantes).where(eq(fuelMandantes.id, filters.mandanteId!)).limit(1)) : undefined,
    filters.supplyMediumId ? nameOf(() => db.select({ name: fuelSupplyMedia.name }).from(fuelSupplyMedia).where(eq(fuelSupplyMedia.id, filters.supplyMediumId!)).limit(1)) : undefined,
  ])
  return { worksite, mandante, medium }
}

/**
 * Filtros en lenguaje de usuario para la hoja de metadatos. Con `names` muestra
 * los nombres en vez de los identificadores; sin ellos, el identificador.
 */
export function describeFilters(filters: ControlFilters, names: FilterNames = {}): Record<string, unknown> {
  return {
    Año: filters.from || filters.to ? undefined : filters.year,
    Meses: filters.from || filters.to ? undefined : (filters.months.length ? filters.months.join(", ") : "Año completo"),
    Desde: filters.from,
    Hasta: filters.to,
    Faena: names.worksite ?? filters.worksiteId,
    Mandante: names.mandante ?? filters.mandanteId,
    Familia: filters.family ? PERFORMANCE_FAMILY_LABELS[filters.family] : undefined,
    Unidad: filters.unit ? PERFORMANCE_UNIT_LABELS[filters.unit] : undefined,
    "Medio de suministro": names.medium ?? filters.supplyMediumId,
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
  const names = await resolveFilterNames(input.filters)
  addExportMetadataSheet(input.wb, input.session, {
    filters: describeFilters(input.filters, names),
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
