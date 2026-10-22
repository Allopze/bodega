/** Utilidades solo para pruebas: construyen un .xlsx en memoria a partir de filas. */
import ExcelJS from "exceljs"

export async function buildXlsx(headers: string[], rows: unknown[][], sheetName = "Datos"): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
