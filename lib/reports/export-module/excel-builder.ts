import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { EXCEL_DATETIME_FORMAT } from "@/lib/reports/excel-dates"
import type { ReportCell, ReportData, ReportSheet } from "./types"

/**
 * Contexto opcional de trazabilidad del archivo.
 *
 * REP-001 / REP-002 (auditoría 2026-09-14): sin esto, el libro no decía quién lo
 * generó ni con qué filtros, y un truncado por límite de filas sólo viajaba en
 * una cabecera HTTP que el enlace de descarga no lee. Es opcional para no
 * obligar a los exportadores que ya arman su propia hoja de metadatos.
 */
export interface XlsxBuildContext {
  session: Session
  filters?: object | null
  from?: string | null
  to?: string | null
  /** Tope de filas aplicado por el llamador, para explicarlo en la advertencia. */
  rowLimit?: number
  /** Salvedades sobre las cifras del libro: una fila «Nota» por cada una en la hoja «Metadatos». */
  notes?: readonly string[]
}

export async function buildXlsxBuffer(report: ReportData, context?: XlsxBuildContext): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  // `sheets` son hojas **adicionales**, no un reemplazo. Antes era un o-lo-uno-o-lo-otro
  // y cualquier reporte que agregara una hoja suplementaria perdía en silencio su propio
  // detalle: el libro de conciliación DTE se descargaba sólo con "Calidad de la
  // referencia", sin la conciliación OC–Factura–DTE ni la columna de discrepancia, y lo
  // mismo les pasaba a valorización de bodega, cobranza y analítica. `report.rows` se
  // calculaba, se contaba para la bitácora de exportación y se tiraba.
  const primarySheet = report.headers.length > 0
    ? [{ worksheetName: report.worksheetName, headers: report.headers, rows: report.rows, columnFormats: report.columnFormats }]
    : []
  const sheets = [...primarySheet, ...(report.sheets ?? [])]

  // Los nombres de hoja se sanean en un solo lugar: los reportes que abren una
  // hoja por faena / trabajador / cliente los derivan de datos y ExcelJS lanza
  // ante caracteres reservados, nombre vacío, >31 caracteres o duplicados.
  const usedNames = new Set<string>()
  for (const sheet of sheets) {
    addWorksheet(workbook, { ...sheet, worksheetName: safeWorksheetName(sheet.worksheetName, usedNames) })
  }

  // REP-001: el truncado tiene que ser evidente DENTRO del archivo. Mismo
  // criterio que la exportación de trazabilidad, que ya lo resolvió así.
  if (report.rowLimitApplied) {
    addWorksheet(workbook, {
      worksheetName: safeWorksheetName("Advertencias", usedNames),
      headers: ["Advertencia", "Detalle"],
      rows: [[
        "Archivo truncado",
        context?.rowLimit
          ? `Se alcanzó el límite de ${context.rowLimit} filas: esta copia NO contiene el total del período. Acota con un rango de fechas, una faena o un estado para incluir el resto.`
          : "Se alcanzó el límite de filas de exportación: esta copia NO contiene el total del período. Acota los filtros para incluir el resto.",
      ]],
    })
  }

  // REP-002: quién generó el archivo, cuándo, con qué alcance y con qué
  // filtros. Ocho rutas ya lo adjuntaban por su cuenta; el centro de reportes
  // era el único que no.
  if (context?.session) {
    await addExportMetadataSheet(workbook, context.session, {
      filters: context.filters ?? null,
      rowCount: sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
      from: context.from ?? null,
      to: context.to ?? null,
      ...(context.notes ? { notes: context.notes } : {}),
    })
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
  const cleaned = cleanWorksheetText(rawName ?? "")
  const shortened = cleaned.length <= WORKSHEET_NAME_MAX ? cleaned : shortenTitle(rawName ?? "", cleaned, WORKSHEET_NAME_MAX)
  const trimmed = shortened.replace(/^'+|'+$/g, "").trim()

  // `History` está reservado por Excel; el resto de los vacíos caen en "Hoja".
  let base = trimmed.length > 0 ? trimmed : "Hoja"
  if (base.toLowerCase() === "history") base = "Historial"

  if (!usedNames) return base
  if (!usedNames.has(base.toLowerCase())) {
    usedNames.add(base.toLowerCase())
    return base
  }

  // Desambiguación con sufijo, recortando la base (en palabra completa si se puede) para no
  // pasarse del límite.
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`
    const room = WORKSHEET_NAME_MAX - suffix.length
    const stem = base.length <= room ? base : cutAtWord(base, room)
    const candidate = `${stem.replace(/^'+|'+$/g, "").trim()}${suffix}`
    if (!usedNames.has(candidate.toLowerCase())) {
      usedNames.add(candidate.toLowerCase())
      return candidate
    }
  }
}

/** Caracteres prohibidos por Excel a espacio, espacios colapsados y extremos limpios. */
function cleanWorksheetText(text: string): string {
  return text.replace(/[*?:\\/[\]]/g, " ").replace(/\s+/g, " ").trim()
}

/** Signos que no pueden quedar colgando al final de un nombre recortado. */
const TRAILING_PUNCTUATION = /[\s,;:.\-\u2013\u2014(&/]+$/

/**
 * Corta `text` a lo más en `max` caracteres sin partir una palabra: se queda con la última
 * palabra completa que cabe y no deja signos colgando. Si no hay ninguna frontera de palabra
 * (una sola palabra más larga que el tope), corta en seco.
 */
function cutAtWord(text: string, max: number): string {
  const head = text.slice(0, max)
  // Si justo después del corte viene un espacio, la última palabra del tramo quedó completa.
  const endsOnBoundary = text.length === max || /\s/.test(text.charAt(max))
  let cut = head
  if (!endsOnBoundary) {
    const lastSpace = head.lastIndexOf(" ")
    if (lastSpace > 0) cut = head.slice(0, lastSpace)
  }
  const tidy = cut.replace(TRAILING_PUNCTUATION, "")
  return tidy.length > 0 ? tidy : head.trim()
}

/**
 * Reduce un título que no cabe en un nombre de hoja. Si tiene «:» o «,» y lo de antes cabe, usa
 * esa parte («Órdenes de trabajo creadas, cerradas…» → «Órdenes de trabajo»); si no, la última
 * palabra completa que quepa. Los nombres que ya caben no pasan por acá.
 */
function shortenTitle(raw: string, cleaned: string, max: number): string {
  const separator = raw.search(/[:,]/)
  if (separator > 0) {
    const lead = cleanWorksheetText(raw.slice(0, separator)).replace(TRAILING_PUNCTUATION, "")
    if (lead.length > 0 && lead.length <= max) return lead
  }
  return cutAtWord(cleaned, max)
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
 * mantención de equipos, control operacional, bitácora/TAE de combustibles) pasaban las
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

/** Un `Date` válido pasa tal cual; uno inválido queda vacío; el resto se sanea como siempre. */
function toWorksheetCell(value: ReportCell): string | number | boolean | Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value
  return sanitizeCell(value)
}

/** Ancho de una columna de fecha con hora (`dd-mm-yyyy hh:mm`). */
const DATE_COLUMN_WIDTH = 17

function addWorksheet(workbook: ExcelJS.Workbook, sheet: ReportSheet) {
  const worksheet = workbook.addWorksheet(sheet.worksheetName)
  worksheet.addRow(sheet.headers)
  for (const row of sheet.rows) worksheet.addRow(row.map(toWorksheetCell))

  // Formato por columna, celda por celda: asignarlo a la columna no siempre alcanza a las filas
  // ya escritas. Una fecha sin formato explícito se muestra con fecha y hora, no como número.
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const format = sheet.columnFormats?.[columnNumber - 1]
      if (format) cell.numFmt = format
      else if (cell.value instanceof Date) cell.numFmt = EXCEL_DATETIME_FORMAT
    })
  })

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }

  worksheet.columns.forEach((column, index) => {
    const header = sheet.headers[index] ?? ""
    let width = Math.max(12, header.length + 2)
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      // `String(Date)` mide unos 60 caracteres y ensanchaba la columna al tope.
      const length = cell.value instanceof Date ? DATE_COLUMN_WIDTH : String(cell.value ?? "").length + 2
      width = Math.max(width, length)
    })
    column.width = Math.min(width, 42)
  })
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.headers.length },
  }
}
