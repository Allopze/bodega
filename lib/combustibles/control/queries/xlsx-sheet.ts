import type ExcelJS from "exceljs"

export interface SheetColumn {
  header: string
  key: string
  width: number
  /** Formato numérico de Excel (p. ej. `#,##0.0`). */
  numFmt?: string
}

export type SheetRow = Record<string, string | number | null>

/** Hoja con encabezado en negrita y fila congelada, el formato común de las exportaciones del control. */
export function addTableSheet(wb: ExcelJS.Workbook, name: string, columns: SheetColumn[], rows: SheetRow[], totalRow?: SheetRow): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name)
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width }))
  for (const column of columns) if (column.numFmt) sheet.getColumn(column.key).numFmt = column.numFmt
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
  for (const row of rows) sheet.addRow(row)
  if (totalRow) sheet.addRow(totalRow).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  return sheet
}
