/**
 * Generic XLSX import service for catalog maintenance.
 *
 * Re-imports catalog data exported via /api/admin/catalogos/export.
 * Uses the ID column to determine create vs. update.
 */

import ExcelJS from "exceljs"

export interface CatalogImportRow {
  rowNumber: number
  values: Record<string, string>
  decision: "create" | "update" | "skip"
  existingId: string | null
  error: string | null
}

export interface CatalogImportResult {
  ok: boolean
  rows: CatalogImportRow[]
  headers: string[]
  sheetName: string
  errors: string[]
}

const REQUIRED_HEADER = "Nombre"

function cellText(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object" && value) {
    const obj = value as Record<string, unknown>
    if (obj.text != null) return String(obj.text).trim()
    if (obj.result != null) return cellText(obj.result)
  }
  return String(value).trim()
}

export async function parseCatalogWorkbook(buffer: Buffer): Promise<CatalogImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as never, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"] })
  } catch {
    return { ok: false, rows: [], headers: [], sheetName: "", errors: ["El archivo no es un XLSX válido o está dañado."] }
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return { ok: false, rows: [], headers: [], sheetName: "", errors: ["El archivo no contiene hojas."] }
  }
  if (sheet.rowCount > 10000) {
    return { ok: false, rows: [], headers: [], sheetName: sheet.name, errors: ["El archivo supera el máximo de 10.000 filas."] }
  }

  const headerCells = sheet.getRow(1).values
  const headers: string[] = []
  if (Array.isArray(headerCells)) {
    for (const cell of headerCells) {
      const text = cellText(cell)
      if (text) headers.push(text)
    }
  }
  if (headers.length < 2) {
    return { ok: false, rows: [], headers: [], sheetName: sheet.name, errors: ["El archivo no tiene suficientes columnas. Usa la plantilla del botón Exportar XLSX."] }
  }
  if (!headers.includes(REQUIRED_HEADER)) {
    return {
      ok: false, rows: [], headers, sheetName: sheet.name,
      errors: [`Falta la columna "${REQUIRED_HEADER}". El archivo tiene: ${headers.join(", ")}. Usa la plantilla del botón Exportar XLSX.`],
    }
  }

  const idIndex = headers.indexOf("ID")
  const rows: CatalogImportRow[] = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      const cell = row.getCell(i + 1).value
      values[headers[i]!] = cellText(cell)
    }
    if (!Object.values(values).some(Boolean)) return

    const existingId = idIndex >= 0 ? values["ID"]?.trim() || null : null
    const name = values[REQUIRED_HEADER]?.trim()

    rows.push({
      rowNumber,
      values,
      decision: name ? (existingId ? "update" : "create") : "skip",
      existingId,
      error: name ? null : `Fila ${rowNumber}: falta el nombre, no se importó.`,
    })
  })

  return { ok: true, rows, headers, sheetName: sheet.name, errors: [] }
}
