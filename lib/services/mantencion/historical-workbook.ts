import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { nameKey } from "@/lib/mantencion/normalize"
import { parseLegacyDate } from "./legacy-import"

export const HISTORICAL_MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 10_000
const MAX_COLUMNS = 80
const MAX_CELL_LENGTH = 100_000

export interface HistoricalField { header: string; value: string; formula?: string; hyperlink?: string }
export interface HistoricalRow {
  sourceKey: string
  fingerprint: string
  sheet: string
  rowNumber: number
  submittedAt: string
  worksiteText: string
  equipmentText: string
  orderText: string
  kindText: string
  readingText: string
  description: string
  entryDate: string | null
  exitDate: string | null
  hoursText: string
  fields: HistoricalField[]
}
export type HistoricalParse = { ok: true; rows: HistoricalRow[] } | { ok: false; message: string }
export interface HistoricalVehicle { id: string; code: string | null; plate: string }
export interface HistoricalWorksite { id: string; name: string }
export type HistoricalMatch = { vehicleId: string | null; state: "linked" | "unmatched" | "conflict" }

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const compact = (value: string | null) => (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "")
const isPhotoColumn = (header: string) => /FOTO|IMAGEN|PHOTO|IMAGE/.test(compact(header))

/** Excel guarda fechas como números sin zona horaria. Se leen en UTC para conservar el calendario que muestra la celda. */
function cellField(cell: ExcelJS.Cell, header: string): HistoricalField {
  const raw = cell.value
  let value = ""
  let formula: string | undefined
  let hyperlink: string | undefined
  if (raw instanceof Date) value = raw.toISOString().replace(/\.\d{3}Z$/, "")
  else if (raw !== null && typeof raw === "object") {
    if ("formula" in raw && typeof raw.formula === "string") formula = raw.formula
    if ("hyperlink" in raw && typeof raw.hyperlink === "string") hyperlink = raw.hyperlink
    if ("text" in raw && typeof raw.text === "string") value = raw.text
    else if ("result" in raw && raw.result != null) value = raw.result instanceof Date ? raw.result.toISOString().replace(/\.\d{3}Z$/, "") : String(raw.result)
    else if ("richText" in raw) value = raw.richText.map((part) => part.text).join("")
    else if ("error" in raw) value = raw.error
  } else if (raw !== null && raw !== undefined) value = String(raw)
  return { header, value, ...(formula ? { formula } : {}), ...(hyperlink ? { hyperlink } : {}) }
}

function timestamp(value: string): string | null {
  const date = parseLegacyDate(value)
  if (!date) return null
  const time = /(?:\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!time) return null
  const h = Number(time[1]); const m = Number(time[2]); const s = Number(time[3] ?? 0)
  if (h > 23 || m > 59 || s > 59) return null
  return `${date} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const REQUIRED: ReadonlyArray<[number, string]> = [
  [1, "MARCATEMPORAL"], [2, "DIRECCIONDECORREOELECTRONICO"], [4, "FAENA"],
  [5, "ORDENDETRABAJO"], [6, "TIPODEACCION"], [12, "EQUIPO"],
  [13, "ODOMETROUHOROMETRO"], [14, "TRABAJOREALIZADO"],
  [16, "FECHAINGRESOEQUIPOTALLER"], [17, "FECHASALIDATALLER"], [18, "HORASTRABAJADAS"],
]

/** El contrato es el consolidado exportado de Forms, no cualquier planilla de mantención. */
export async function parseHistoricalWorkbook(buffer: ArrayBuffer): Promise<HistoricalParse> {
  if (buffer.byteLength > HISTORICAL_MAX_BYTES) return { ok: false, message: "El archivo supera 5 MB." }
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer as ExcelJS.Buffer) }
  catch { return { ok: false, message: "No se pudo leer el archivo Excel." } }
  if (!workbook.worksheets.length) return { ok: false, message: "La planilla no contiene hojas." }
  if (workbook.worksheets.length > 50) return { ok: false, message: "El archivo contiene demasiadas hojas." }
  const rows: HistoricalRow[] = []
  const keys = new Set<string>()
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > MAX_ROWS * 2) return { ok: false, message: `La hoja ${sheet.name} declara demasiadas filas.` }
    if (sheet.columnCount > MAX_COLUMNS) return { ok: false, message: `La hoja ${sheet.name} tiene demasiadas columnas.` }
    const first = sheet.getRow(1)
    if (REQUIRED.some(([n, prefix]) => !compact(cellField(first.getCell(n), "").value).startsWith(prefix))) {
      return { ok: false, message: `La hoja ${sheet.name} no tiene las columnas del consolidado de mantención.` }
    }
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => cellField(first.getCell(index + 1), "").value.trim() || `Columna ${index + 1}`)
    for (let number = 2; number <= sheet.rowCount; number++) {
      const row = sheet.getRow(number)
      const cells = headers.map((header, index) => isPhotoColumn(header) ? null : cellField(row.getCell(index + 1), header))
      if (!cells.some((field) => field && (field.value || field.formula || field.hyperlink))) continue
      if (cells.some((field) => field && (field.value.length > MAX_CELL_LENGTH || (field.formula?.length ?? 0) > MAX_CELL_LENGTH || (field.hyperlink?.length ?? 0) > MAX_CELL_LENGTH))) {
        return { ok: false, message: `${sheet.name}, fila ${number}: una celda es demasiado extensa.` }
      }
      if (rows.length >= MAX_ROWS) return { ok: false, message: `El archivo supera ${MAX_ROWS} filas de datos.` }
      const value = (index: number) => cells[index - 1]?.value ?? ""
      const submittedAt = parseLegacyDate(value(1))
      const sourceTimestamp = timestamp(value(1))
      const email = value(2).trim().toLowerCase()
      if (!submittedAt || !email) return { ok: false, message: `${sheet.name}, fila ${number}: falta una fecha de envío válida o el correo de origen.` }
      // La hora puede distinguir respuestas originales, pero no es un dato de trabajo ni se guarda.
      cells[0] = { header: "Fecha de envío", value: submittedAt }
      const fields = cells.filter((field): field is HistoricalField => field !== null)
      const fingerprint = hash(JSON.stringify(fields))
      const sourceKey = sourceTimestamp
        ? hash(`google-forms\n${sourceTimestamp}\n${email}`)
        : hash(`google-forms-sin-hora\n${submittedAt}\n${email}\n${fingerprint}`)
      if (keys.has(sourceKey)) return { ok: false, message: `${sheet.name}, fila ${number}: hay respuestas con la misma identidad de origen. Revisa el posible duplicado.` }
      keys.add(sourceKey)
      rows.push({
        sourceKey, fingerprint, sheet: sheet.name, rowNumber: number, submittedAt,
        worksiteText: value(4), orderText: value(5), kindText: value(6), equipmentText: value(12), readingText: value(13),
        description: value(14), entryDate: parseLegacyDate(value(16)), exitDate: parseLegacyDate(value(17)), hoursText: value(18), fields,
      })
    }
  }
  if (!rows.length) return { ok: false, message: "La planilla no contiene respuestas para importar." }
  return { ok: true, rows }
}

/** Código y patente deben señalar al mismo vehículo. Un desacuerdo nunca se corrige eligiendo uno. */
export function resolveHistoricalEquipment(text: string, vehicles: readonly HistoricalVehicle[]): HistoricalMatch {
  const parts = text.split("/").map((part) => compact(part)).filter(Boolean)
  if (!parts.length) return { vehicleId: null, state: "unmatched" }
  if (parts.length > 2) return { vehicleId: null, state: "conflict" }
  const code = vehicles.filter((vehicle) => compact(vehicle.code) === parts[0])
  const plate = vehicles.filter((vehicle) => compact(vehicle.plate) === (parts[1] ?? parts[0]))
  if (code.length > 1 || plate.length > 1) return { vehicleId: null, state: "conflict" }
  if (parts.length === 2) {
    if (!code.length && !plate.length) return { vehicleId: null, state: "unmatched" }
    if (!code[0] || !plate[0] || code[0].id !== plate[0].id) return { vehicleId: null, state: "conflict" }
    return { vehicleId: code[0].id, state: "linked" }
  }
  if (code[0] && plate[0] && code[0].id !== plate[0].id) return { vehicleId: null, state: "conflict" }
  const match = code[0] ?? plate[0]
  return match ? { vehicleId: match.id, state: "linked" } : { vehicleId: null, state: "unmatched" }
}

export function resolveHistoricalWorksite(text: string, sites: readonly HistoricalWorksite[]): string | null {
  const key = nameKey(text)
  const exact = sites.filter((site) => nameKey(site.name) === key)
  if (exact.length === 1) return exact[0]!.id
  if (exact.length > 1) return null
  const alias = key === "cholguan" ? "cholguan - arauco" : null
  const matched = alias ? sites.filter((site) => nameKey(site.name) === alias) : []
  return matched.length === 1 ? matched[0]!.id : null
}
