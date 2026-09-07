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

  // Los nombres de hoja se sanean en un solo lugar: los reportes que abren una
  // hoja por faena / trabajador / cliente los derivan de datos y ExcelJS lanza
  // ante caracteres reservados, nombre vacío, >31 caracteres o duplicados.
  const usedNames = new Set<string>()
  for (const sheet of sheets) {
    addWorksheet(workbook, { ...sheet, worksheetName: safeWorksheetName(sheet.worksheetName, usedNames) })
  }

  const data = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(data as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Límite duro de Excel para el nombre de una hoja. */
const WORKSHEET_NAME_MAX = 31

/**
 * Devuelve un nombre de hoja que Excel acepta, único dentro del libro.
 *
 * ExcelJS lanza —y aborta la exportación completa— si el nombre lleva alguno de
 * `* ? : \ / [ ]`, empieza o termina en comilla simple, está vacío, es el
 * reservado `History`, o ya existe en el libro. Los reportes que generan una
 * hoja por entidad (faena, trabajador, cliente) toman el nombre de datos de
 * usuario, así que cualquiera de esos casos es alcanzable en producción: una
 * faena "Planta Norte / Sur" o dos personas cuyos nombres coinciden en los
 * primeros 31 caracteres bastaban para romper el archivo entero.
 *
 * `usedNames` acumula los nombres ya emitidos, **en minúsculas**: ExcelJS
 * compara duplicados con `toLowerCase()`, así que un registro sensible a
 * mayúsculas dejaría pasar "Faena Norte" y "FAENA NORTE" como distintos y la
 * segunda `addWorksheet` abortaría el archivo entero. Es un registro interno;
 * el nombre que se usa es el que devuelve la función.
 */
export function safeWorksheetName(rawName: string | undefined, usedNames?: Set<string>): string {
  // El orden importa: las comillas se quitan **después** de recortar y trimear.
  // Al revés, un "/'Faena A" (el reservado se vuelve espacio y desplaza la
  // comilla) o un nombre de 32 caracteres con comilla en la posición 31
  // terminaban empezando o terminando en comilla simple —que Excel rechaza—
  // pese a haber pasado por el saneado.
  const cleaned = (rawName ?? "")
    .replace(/[*?:\\/[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WORKSHEET_NAME_MAX)
    .replace(/^'+|'+$/g, "")
    .trim()

  // `History` está reservado por Excel; el resto de los vacíos caen en "Hoja".
  let base = cleaned.length > 0 ? cleaned : "Hoja"
  if (base.toLowerCase() === "history") base = "Historial"

  if (!usedNames) return base
  if (!usedNames.has(base.toLowerCase())) {
    usedNames.add(base.toLowerCase())
    return base
  }

  // Desambiguación con sufijo, recortando la base para no pasarse del límite.
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`
    const candidate = `${base.slice(0, WORKSHEET_NAME_MAX - suffix.length).trim()}${suffix}`
    if (!usedNames.has(candidate.toLowerCase())) {
      usedNames.add(candidate.toLowerCase())
      return candidate
    }
  }
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
