/**
 * Piezas comunes de los importadores del submódulo de control (telemetría y
 * entradas de suministro): lectura tolerante de la hoja, números y fechas con
 * formato chileno, hash del archivo y resolución de equipos y faenas.
 * Todo es lógica pura: el acceso a la base vive en `service.ts`.
 */
import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { isExcelErrorText, parseExactChileanDecimal, parseSheetDate, plateMatchKey, sheetToRecords } from "@/lib/combustibles/xlsx-utils"
import { isFillerDate } from "@/lib/combustibles/control/validation"

export { CONTROL_IMPORT_KIND_LABELS, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, type ControlImportKind } from "./constants"
import { MAX_IMPORT_ROWS } from "./constants"

export interface ImportRowIssue {
  rowIndex: number
  field: string
  message: string
}

export type RawRow = Record<string, unknown>

export function sha256Hex(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex")
}

/** Minúsculas, sin tildes ni signos de borde, espacios colapsados: para comparar encabezados y nombres. */
export function normalizeLookup(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Lectura de la hoja ─────────────────────────────────────────────────────

export interface ColumnSpec {
  key: string
  /** Encabezado de la plantilla y alias aceptados (se comparan normalizados). */
  headers: string[]
  required: boolean
}

export interface SheetReadResult {
  rows: Array<{ rowIndex: number; values: Record<string, unknown>; raw: RawRow }>
  /** Encabezados obligatorios que el archivo no trae. */
  missing: string[]
  fileIssue?: string
}

function headerMap(sheet: ExcelJS.Worksheet): Map<string, string> {
  const map = new Map<string, string>()
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    const text = String(cell.value && typeof cell.value === "object" && "richText" in cell.value
      ? (cell.value.richText as Array<{ text: string }>).map((part) => part.text).join("")
      : cell.value ?? "")
    if (text.trim()) map.set(normalizeLookup(text), text)
  })
  return map
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
}

export async function readSheetRows(buffer: Uint8Array, columns: ColumnSpec[]): Promise<SheetReadResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch {
    return { rows: [], missing: [], fileIssue: "No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) válido y no esté protegido con contraseña." }
  }
  const required = columns.filter((column) => column.required)
  const covers = (map: Map<string, string>, column: ColumnSpec) => column.headers.some((header) => map.has(normalizeLookup(header)))
  const sheet = workbook.worksheets.find((candidate) => {
    const map = headerMap(candidate)
    return required.every((column) => covers(map, column))
  }) ?? workbook.worksheets[0]
  if (!sheet) return { rows: [], missing: [], fileIssue: "El archivo no tiene hojas." }

  const map = headerMap(sheet)
  const missing = required.filter((column) => !covers(map, column)).map((column) => column.headers[0]!)
  if (missing.length > 0) return { rows: [], missing }

  const records = sheetToRecords(sheet)
  const rows: SheetReadResult["rows"] = []
  for (const record of records) {
    const values: Record<string, unknown> = {}
    for (const column of columns) {
      const header = column.headers.map((candidate) => map.get(normalizeLookup(candidate))).find(Boolean)
      values[column.key] = header ? record[header] ?? null : null
    }
    if (Object.values(values).every(isBlank)) continue
    const { __row, ...raw } = record
    rows.push({ rowIndex: __row, values, raw })
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return { rows: [], missing: [], fileIssue: `El archivo tiene más de ${MAX_IMPORT_ROWS.toLocaleString("es-CL")} filas. Divídelo por período e importa cada parte.` }
  }
  return { rows, missing: [] }
}

// ── Celdas ─────────────────────────────────────────────────────────────────

export type CellNumber = { status: "empty" } | { status: "value"; value: number } | { status: "invalid"; message: string }

/** Número con formato chileno o celda numérica de Excel. Vacío no es 0: se informa aparte. */
export function readNumberCell(value: unknown): CellNumber {
  if (isBlank(value)) return { status: "empty" }
  if (typeof value === "number") return Number.isFinite(value) ? { status: "value", value } : { status: "invalid", message: "no es un número" }
  if (isExcelErrorText(value)) return { status: "invalid", message: `la celda trae un error de Excel (${String(value).trim()})` }
  const parsed = parseExactChileanDecimal(value, 6, 16)
  if (parsed.status === "empty") return { status: "empty" }
  if (parsed.status === "invalid") return { status: "invalid", message: "no es un número válido (usa coma decimal, ej. 85,5)" }
  return { status: "value", value: Number(parsed.normalized) }
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export type CellDate = { status: "empty" } | { status: "value"; day: string } | { status: "invalid"; message: string }

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

/** Fecha civil «YYYY-MM-DD» de una celda de fecha, texto dd-mm-aaaa o serial de Excel. Rechaza fechas de relleno. */
export function readDateCell(value: unknown): CellDate {
  if (isBlank(value)) return { status: "empty" }
  let normalized = value
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 2_958_465) return { status: "invalid", message: "no es una fecha válida" }
    normalized = new Date(EXCEL_EPOCH_MS + Math.floor(value) * 86_400_000)
  }
  const day = parseSheetDate(normalized)
  if (!day) return { status: "invalid", message: "no es una fecha válida (usa dd-mm-aaaa, ej. 15-01-2026)" }
  if (isFillerDate(day)) return { status: "invalid", message: "fecha de relleno (p. ej. 30-12-1899): no corresponde a un día real" }
  return { status: "value", day }
}

/** Hora «HH:MM» de una celda de hora de Excel, fracción de día o texto. */
export function readTimeCell(value: unknown): { status: "empty" } | { status: "value"; hours: number; minutes: number } | { status: "invalid" } {
  if (isBlank(value)) return { status: "empty" }
  if (value instanceof Date) return { status: "value", hours: value.getUTCHours(), minutes: value.getUTCMinutes() }
  if (typeof value === "number") {
    if (value < 0 || value >= 1) return { status: "invalid" }
    const total = Math.round(value * 24 * 60)
    return { status: "value", hours: Math.floor(total / 60) % 24, minutes: total % 60 }
  }
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim())
  if (!match) return { status: "invalid" }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? { status: "value", hours, minutes } : { status: "invalid" }
}

// ── Resolución de equipos y faenas ─────────────────────────────────────────

export interface IndexedVehicle {
  id: string
  code: string | null
  plate: string
  worksiteId: string
}

export type VehicleLookup = { status: "found"; vehicle: IndexedVehicle } | { status: "unknown" } | { status: "ambiguous" }

/** Índice por código interno y patente (sin separadores): «KA-63» y «KA63» son el mismo equipo. */
export function buildVehicleIndex(vehicles: IndexedVehicle[]): { find: (token: string) => VehicleLookup } {
  const byKey = new Map<string, Map<string, IndexedVehicle>>()
  const add = (key: string, vehicle: IndexedVehicle) => {
    if (!key) return
    const bucket = byKey.get(key) ?? new Map<string, IndexedVehicle>()
    bucket.set(vehicle.id, vehicle)
    byKey.set(key, bucket)
  }
  for (const vehicle of vehicles) {
    add(plateMatchKey(vehicle.plate), vehicle)
    if (vehicle.code) add(plateMatchKey(vehicle.code), vehicle)
  }
  return {
    find(token) {
      const bucket = byKey.get(plateMatchKey(token))
      if (!bucket || bucket.size === 0) return { status: "unknown" }
      if (bucket.size > 1) return { status: "ambiguous" }
      return { status: "found", vehicle: [...bucket.values()][0]! }
    },
  }
}

export interface IndexedWorksite { id: string; name: string; code: string | null }

export type WorksiteLookup = { status: "found"; worksite: IndexedWorksite } | { status: "unknown" } | { status: "ambiguous" }

/** Faena por nombre o código, sin distinguir mayúsculas ni tildes. */
export function buildWorksiteIndex(worksites: IndexedWorksite[]): { find: (token: string) => WorksiteLookup } {
  const byKey = new Map<string, Map<string, IndexedWorksite>>()
  const add = (key: string, worksite: IndexedWorksite) => {
    if (!key) return
    const bucket = byKey.get(key) ?? new Map<string, IndexedWorksite>()
    bucket.set(worksite.id, worksite)
    byKey.set(key, bucket)
  }
  for (const worksite of worksites) {
    add(normalizeLookup(worksite.name), worksite)
    if (worksite.code) add(normalizeLookup(worksite.code), worksite)
  }
  return {
    find(token) {
      const bucket = byKey.get(normalizeLookup(token))
      if (!bucket || bucket.size === 0) return { status: "unknown" }
      if (bucket.size > 1) return { status: "ambiguous" }
      return { status: "found", worksite: [...bucket.values()][0]! }
    },
  }
}

export function textCell(value: unknown): string {
  return isBlank(value) ? "" : String(value).replace(/\s+/g, " ").trim()
}
