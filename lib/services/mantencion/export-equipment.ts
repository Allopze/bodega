import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import { stateRank } from "@/lib/mantencion/status"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { todayInChile } from "@/lib/utils"
import { equipmentScope, viewerFromSession } from "./access"
import { loadFleet, type FleetRow } from "./fleet"

/**
 * Excel de equipos (§12): equipo, estado, lectura y próxima mantención, con las
 * fechas como fecha real. Exporta lo que la persona ve en la lista: recibe los
 * ids visibles y los vuelve a cargar dentro de SU alcance de faenas, así que un
 * id ajeno simplemente no sale. Quien llama exige `mant:export`.
 */

export const HEADER_FILL = "FF005C3F"

/** Encabezado con estilo, fila 1 fija y autofiltro: el mismo acabado en todos los libros del módulo. */
export function styleHeaderRow(sheet: ExcelJS.Worksheet, columnCount: number) {
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }
  header.alignment = { vertical: "middle", wrapText: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } }
}

export interface EquipmentExportInput {
  /** Ids visibles en la lista, en su orden; `null` = toda la flota del alcance. */
  vehicleIds: string[] | null
  includeRetired: boolean
  /** Filtros que la persona tenía puestos, sólo para la hoja de metadatos y la auditoría. */
  filters: Record<string, string | boolean>
}

const COLUMNS: Array<{ header: string; key: string; width: number; numeric?: boolean; date?: boolean }> = [
  { header: "Código", key: "code", width: 12 },
  { header: "Patente", key: "plate", width: 12 },
  { header: "Tipo", key: "type", width: 20 },
  { header: "Marca", key: "brand", width: 16 },
  { header: "Modelo", key: "model", width: 18 },
  { header: "Año", key: "year", width: 8, numeric: true },
  { header: "Faena", key: "worksite", width: 20 },
  { header: "Pauta", key: "schedule", width: 24 },
  { header: "Unidad", key: "unit", width: 9 },
  { header: "Estado", key: "state", width: 14 },
  { header: "Lectura actual", key: "reading", width: 15, numeric: true },
  { header: "Fecha de la lectura", key: "readingDate", width: 18, date: true },
  { header: "Próxima mantención", key: "next", width: 19, numeric: true },
  { header: "Falta (negativo = pasada)", key: "remaining", width: 24, numeric: true },
  { header: "Intervalo que toca", key: "nextInterval", width: 18, numeric: true },
  { header: "Última preventiva (lectura)", key: "lastReading", width: 25, numeric: true },
  { header: "Fecha de la última preventiva", key: "lastDate", width: 27, date: true },
  { header: "En taller", key: "workshop", width: 10 },
]

function rowValues(row: FleetRow) {
  const { status } = row
  return {
    code: row.code,
    plate: row.noPlate ? "Sin patente" : row.plate,
    type: row.typeName,
    brand: row.brandName,
    model: row.model ?? "",
    year: row.year,
    worksite: row.worksiteName,
    schedule: row.scheduleName ?? "Sin pauta",
    unit: row.unit,
    state: EQUIPMENT_STATE_LABEL[status.state],
    reading: status.currentReading?.value ?? null,
    readingDate: excelPlainDate(status.currentReading?.date),
    next: status.nextReading,
    // Negativo = pasada, igual que en pantalla: el Excel se ordena y filtra como número.
    remaining: status.remaining,
    nextInterval: status.nextIntervalValue,
    lastReading: status.lastPreventive?.reading ?? null,
    lastDate: excelPlainDate(status.lastPreventive?.date),
    workshop: row.workshop ? "Sí" : "No",
  }
}

export async function exportEquipment(
  session: Session,
  input: EquipmentExportInput,
): Promise<{ base64: string; filename: string; rowCount: number }> {
  const viewer = viewerFromSession(session)
  const fleet = await loadFleet({
    scope: equipmentScope(viewer),
    includeRetired: input.includeRetired,
    vehicleIds: input.vehicleIds ?? undefined,
    readingsPerEquipment: 1,
  })
  const order = input.vehicleIds ? new Map(input.vehicleIds.map((id, index) => [id, index])) : null
  const rows = [...fleet].sort((a, b) => order
    ? (order.get(a.vehicleId) ?? 0) - (order.get(b.vehicleId) ?? 0)
    : stateRank(a.status.state) - stateRank(b.status.state) || a.code.localeCompare(b.code, "es", { numeric: true }))

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }))
  for (const row of rows) sheet.addRow(rowValues(row))
  for (const column of COLUMNS) {
    const target = sheet.getColumn(column.key)
    if (column.date) target.numFmt = EXCEL_DATE_FORMAT
    if (column.numeric) target.numFmt = column.key === "year" ? "0" : "#,##0"
  }
  styleHeaderRow(sheet, COLUMNS.length)
  addExportMetadataSheet(workbook, session, { filters: input.filters, rowCount: rows.length })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_equipment_export",
    entityId: nanoid(),
    newState: { filters: input.filters, rowCount: rows.length },
  })
  return { base64: await xlsxToBase64(workbook), filename: `equipos-mantencion_${todayInChile()}.xlsx`, rowCount: rows.length }
}
