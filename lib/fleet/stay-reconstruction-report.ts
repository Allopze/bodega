import ExcelJS from "exceljs"
import { formatDate } from "@/lib/utils"
import { pendingReasonLabel, type ReportStay, type StayRunResult, type VehicleOutcome } from "./stay-reconstruction-run"

/**
 * Informe Excel de la reconstrucción: una hoja por destino de cada equipo.
 * Las fechas van como fechas de Excel (no como texto) para poder ordenarlas y filtrarlas.
 */

export const STAY_REPORT_SHEETS = {
  applied: "Se aplica",
  toConfirm: "Por confirmar",
  noEvidence: "Sin evidencia",
  skipped: "Saltados (con traslado)",
  unmatched: "Sin calce",
  failed: "Con error",
} as const

const DATE_FORMAT = "dd-mm-yyyy"

/** `YYYY-MM-DD` → fecha de Excel (medianoche UTC, sin corrimiento por zona horaria). */
function excelDate(day: string | null): Date | null {
  return day ? new Date(`${day}T00:00:00Z`) : null
}

interface Column {
  header: string
  width: number
  date?: boolean
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Array<Array<string | number | Date | null>>) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] })
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width, style: column.date ? { numFmt: DATE_FORMAT } : {} }))
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return sheet
}

const vehicleCells = (vehicle: VehicleOutcome) => [vehicle.code ?? "", vehicle.plate, vehicle.currentWorksite]

/** «Faena (desde – hasta)» por estadía, para leer la propuesta completa en una celda. */
function proposalText(stays: ReportStay[]): string {
  return stays
    .map((stay) => `${stay.worksite} (${stay.startedOn ? formatDate(stay.startedOn) : "desde siempre"} – ${stay.endedOn ? formatDate(stay.endedOn) : "hoy"})`)
    .join("; ")
}

export function buildStayReportWorkbook(result: StayRunResult): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const stayColumns: Column[] = [
    { header: "Código", width: 12 }, { header: "Patente", width: 12 }, { header: "Faena actual", width: 22 },
    { header: "Faena de la estadía", width: 24 }, { header: "Desde", width: 12, date: true }, { header: "Hasta", width: 12, date: true },
    { header: "Evidencia", width: 60 }, { header: "Motivo", width: 40 },
  ]
  const stayRows = (vehicles: VehicleOutcome[]) => vehicles.flatMap((vehicle) =>
    vehicle.stays.map((stay) => [...vehicleCells(vehicle), stay.worksite, excelDate(stay.startedOn), excelDate(stay.endedOn), stay.evidence, vehicle.note]))

  addSheet(workbook, STAY_REPORT_SHEETS.applied, stayColumns, stayRows(result.applied))

  addSheet(workbook, STAY_REPORT_SHEETS.toConfirm, [
    { header: "Código", width: 12 }, { header: "Patente", width: 12 }, { header: "Faena actual", width: 22 },
    { header: "Motivo", width: 44 }, { header: "Faena de origen", width: 22 }, { header: "Faena de destino", width: 22 },
    { header: "Último día en el origen", width: 16, date: true }, { header: "Primer día en el destino", width: 16, date: true },
    { header: "Días sin evidencia", width: 12 }, { header: "Detalle", width: 80 }, { header: "Propuesta (no se escribe)", width: 80 },
  ], result.toConfirm.flatMap((vehicle) => vehicle.pending.map((change) => [
    ...vehicleCells(vehicle), pendingReasonLabel(change.reason), change.fromWorksite ?? "", change.toWorksite,
    excelDate(change.lastDayInFrom), excelDate(change.firstDayInTo), change.gapDays, change.detail, proposalText(vehicle.stays),
  ])))

  addSheet(workbook, STAY_REPORT_SHEETS.noEvidence, [
    { header: "Código", width: 12 }, { header: "Patente", width: 12 }, { header: "Faena actual", width: 22 }, { header: "Motivo", width: 60 },
  ], result.noEvidence.map((vehicle) => [...vehicleCells(vehicle), vehicle.note]))

  addSheet(workbook, STAY_REPORT_SHEETS.skipped, [
    { header: "Código", width: 12 }, { header: "Patente", width: 12 }, { header: "Faena actual", width: 22 }, { header: "Motivo", width: 60 },
  ], result.skippedTransfers.map((vehicle) => [...vehicleCells(vehicle), vehicle.note]))

  addSheet(workbook, STAY_REPORT_SHEETS.unmatched, [
    { header: "Fecha", width: 12, date: true }, { header: "Código", width: 12 }, { header: "Patente", width: 12 },
    { header: "Faena", width: 24 }, { header: "Por qué no calza", width: 60 },
  ], result.unmatched.map((row) => [excelDate(row.date), row.code ?? "", row.plate ?? "", row.worksiteName, row.why]))

  if (result.failed.length > 0) {
    addSheet(workbook, STAY_REPORT_SHEETS.failed, [
      { header: "Código", width: 12 }, { header: "Patente", width: 12 }, { header: "Error", width: 80 },
    ], result.failed.map((row) => [row.code ?? "", row.plate, row.message]))
  }
  return workbook
}

export async function writeStayReport(result: StayRunResult, filePath: string): Promise<void> {
  await buildStayReportWorkbook(result).xlsx.writeFile(filePath)
}
