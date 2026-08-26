import ExcelJS from "exceljs"
import type { ReportData, ReportSheet } from "./types"

export async function buildXlsxBuffer(report: ReportData): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const sheets = report.sheets?.length ? report.sheets : [{
    worksheetName: report.worksheetName,
    headers: report.headers,
    rows: report.rows,
  }]

  for (const sheet of sheets) addWorksheet(workbook, sheet)

  const data = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(data as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Neutraliza inyección de fórmulas (CSV injection) sin tocar números. Idempotente. */
export function sanitizeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return ""
  if (typeof value === "number" || typeof value === "boolean") return value
  const text = typeof value === "object" ? JSON.stringify(value) : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

/**
 * Serializa el workbook a base64 aplicando `sanitizeCell` a cada celda.
 *
 * Las acciones de exportación que arman su workbook a mano (flota,
 * mantenciones, control operacional, bitácora/TAE de combustibles) pasaban las
 * celdas sin sanitizar y repetían el par `writeBuffer` → `Buffer.from(...).
 * toString("base64")` en cada archivo. Este es el punto único de salida.
 */
export async function xlsxToBase64(workbook: ExcelJS.Workbook): Promise<string> {
  // Algunos consumidores/test doubles sólo implementan `addWorksheet` y
  // `xlsx.writeBuffer`; la sanitización es best-effort en ese caso y la
  // serialización conserva el contrato anterior.
  for (const worksheet of workbook.worksheets ?? []) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.value = sanitizeCell(cell.value)
      })
    })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer).toString("base64")
}

function addWorksheet(workbook: ExcelJS.Workbook, sheet: ReportSheet) {
  const worksheet = workbook.addWorksheet(sheet.worksheetName)
  worksheet.addRow(sheet.headers)
  for (const row of sheet.rows) worksheet.addRow(row.map(sanitizeCell))

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }

  worksheet.columns.forEach((column, index) => {
    const header = sheet.headers[index] ?? ""
    let width = Math.max(12, header.length + 2)
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.max(width, String(cell.value ?? "").length + 2)
    })
    column.width = Math.min(width, 42)
  })
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.headers.length },
  }
}
