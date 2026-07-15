/**
 * Helpers XLSX compartidos del módulo combustibles: parsers de importación
 * (facturas — `import.ts` — y consumos por patente — `consumption-import.ts`)
 * y la hoja de metadatos que llevan las 4 exportaciones del módulo.
 */

import ExcelJS from "exceljs"
import type { Session } from "next-auth"

/** Normaliza un encabezado de columna: colapsa espacios/saltos de línea,
 *  recorta y pasa a minúsculas, para comparar de forma tolerante. */
export function normKey(key: string): string {
  return key.replace(/\s+/g, " ").trim().toLowerCase()
}

/** Reduce un valor de celda de ExcelJS (texto enriquecido, fórmula, hipervínculo,
 *  fecha o primitivo) al valor plano que el resto del parser espera. */
export function normalizeCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("")
    }
    if ("result" in value) return value.result ?? null
    if ("text" in value) return value.text
  }
  return value
}

/** Convierte la primera fila de la hoja en encabezados y el resto en objetos
 *  `{ encabezado: valor }`, replicando el comportamiento de `defval: null`. */
export function sheetToRecords(sheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const headers: (string | null)[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = normalizeCellValue(cell.value)
    headers[colNumber] = value === null ? null : String(value)
  })

  const records: Record<string, unknown>[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: Record<string, unknown> = {}
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col]
      if (!header) continue
      record[header] = normalizeCellValue(row.getCell(col).value)
    }
    records.push(record)
  })
  return records
}

/** Convierte un valor de celda (número, o texto con formato chileno —
 *  miles con "." y decimales con ",") a número. Vacío/no numérico → 0. */
export function parseChileanNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[$\s]/g, "")
    if (!cleaned || cleaned === "-") return 0
    const n = parseFloat(cleaned.replace(/[,.](?=\d{3})/g, "").replace(",", "."))
    return isNaN(n) ? 0 : n
  }
  return 0
}

/** Como parseChileanNumber pero preserva null para valores vacíos. */
export function nullableChileanNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = parseChileanNumber(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Hoja "Metadatos": hace cualquier exportación del módulo autocontenida y
 * reproducible — quién, cuándo, con qué filtros y con qué alcance de faena
 * la generó. Compartida por las 4 exportaciones XLSX del módulo (bitácora,
 * TAE, facturas, conciliación TAE/Copec); antes sólo la tenía la de bitácora.
 */
export function addExportMetadataSheet(
  wb: ExcelJS.Workbook,
  session: Session,
  context: { filters?: object | null; rowCount: number; from?: string | null; to?: string | null },
) {
  const ws = wb.addWorksheet("Metadatos")
  ws.columns = [{ key: "label", width: 22 }, { key: "value", width: 60 }]
  const entries: Array<[string, string]> = [
    ["Generado", new Date().toLocaleString("es-CL")],
    ["Generado por", session.user.email ?? session.user.name ?? session.user.id],
    ["Alcance de faena", session.user.isGlobal ? "Todas las faenas (usuario global)" : (session.user.worksiteIds ?? []).join(", ") || "Sin faenas asignadas"],
    ["Filas incluidas", String(context.rowCount)],
    ["Período (desde)", context.from ?? "Sin filtro"],
    ["Período (hasta)", context.to ?? "Sin filtro"],
    ["Filtros aplicados", context.filters ? JSON.stringify(Object.fromEntries(Object.entries(context.filters).filter(([, v]) => v !== undefined))) : "Selección manual de filas"],
  ]
  for (const [label, value] of entries) ws.addRow({ label, value })
  ws.getColumn("label").font = { bold: true }
}
