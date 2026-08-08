import ExcelJS from "exceljs"
import { normKey, sheetToRecords, santiagoInstant } from "./xlsx-utils"

export interface TaeLegacyImportError {
  rowIndex: number
  field: string
  message: string
}

export interface ParsedTaeLegacyRow {
  rowIndex: number
  legacySourceId: string
  worksiteName: string
  loadedAt: string
  loadingPointName: string
  supervisorName: string
  driverName: string
  equipmentCode: string
  meterReading: number | null
  meterRaw: string | null
  liters: number
  removedSealNumber: string | null
  installedSealNumber: string | null
  notes: string | null
  evidenceUrls: Record<"odometer" | "liter_meter" | "removed_seal" | "installed_seal", string | null>
  rawRow: Record<string, unknown>
}

export interface TaeLegacyImportResult {
  rows: ParsedTaeLegacyRow[]
  errors: TaeLegacyImportError[]
}

/** Reinterpreta una fila persistida en `rawRow` usando exactamente el contrato del importador. */
export function parseTaeLegacyRecord(rawRow: Record<string, unknown>, rowIndex: number): { row: ParsedTaeLegacyRow | null; error: TaeLegacyImportError | null } {
  const values = new Map(Object.entries(rawRow).map(([key, value]) => [normKey(key), value]))
  const get = (key: string) => values.get(normKey(key))
  const legacySourceId = text(get("id"))
  const worksiteName = text(get("faena"))
  const loadedAt = formatTimestamp(get("fecha y hora"))
  const loadingPointName = text(get("lugar de carga"))
  const supervisorName = text(get("supervisor / líder"))
  const driverName = text(get("conductor"))
  const equipmentCode = text(get("equipo"))
  const liters = strictNumber(get("litros"))

  if (!legacySourceId || !worksiteName || !loadedAt || !loadingPointName || !supervisorName || !driverName || !equipmentCode || liters == null || liters <= 0) {
    const fields = [
      !legacySourceId && "ID",
      !worksiteName && "Faena",
      !loadedAt && "Fecha y hora",
      !loadingPointName && "Lugar de carga",
      !supervisorName && "Supervisor / líder",
      !driverName && "Conductor",
      !equipmentCode && "Equipo",
      (liters == null || liters <= 0) && "Litros",
    ].filter(Boolean).join(", ")
    return { row: null, error: { rowIndex, field: fields, message: "Fila incompleta o con litros inválidos" } }
  }

  const meterRaw = text(get("odómetro"))
  return {
    error: null,
    row: {
      rowIndex,
      legacySourceId,
      worksiteName,
      loadedAt,
      loadingPointName,
      supervisorName,
      driverName,
      equipmentCode,
      meterReading: strictNumber(meterRaw),
      meterRaw,
      liters,
      removedSealNumber: text(get("n.º sello retirado")),
      installedSealNumber: text(get("n.º sello instalado")),
      notes: text(get("observaciones")),
      evidenceUrls: {
        odometer: text(get("imagen odómetro")),
        liter_meter: text(get("imagen medidor de litros")),
        removed_seal: text(get("imagen sello retirado")),
        installed_seal: text(get("imagen sello instalado")),
      },
      rawRow,
    },
  }
}

const REQUIRED_HEADERS = ["id", "faena", "fecha y hora", "lugar de carga", "supervisor / líder", "conductor", "equipo", "odómetro", "litros"]

function text(value: unknown): string | null {
  const valueText = String(value ?? "").trim()
  return valueText || null
}

function strictNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const valueText = text(value)
  if (!valueText) return null
  const normalized = valueText.replace(/\s/g, "").replace(",", ".")
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null
}

// "DD-MM-YYYY[ HH:mm[:ss]]" o "YYYY-MM-DD[ HH:mm[:ss]]" (acepta "-" o "/"), sin zona.
const DATE_TIME_TEXT = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
// Ya trae zona explícita (Z o ±HH:mm) — es un instante ya correcto, no hora de pared sin zonificar.
const HAS_EXPLICIT_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * "Fecha y hora" es UNA celda combinada. ExcelJS decodifica los seriales de
 * fecha de Excel como si fueran UTC — `date.toISOString()` a secas conserva la
 * hora de PARED chilena pero la etiqueta como instante UTC, corriendo cada
 * carga 3–4 horas (y cambiando de mes las nocturnas de fin de mes). Pasar el
 * mismo `Date` como fecha y como hora a `santiagoInstant` reinterpreta esos
 * mismos componentes de pared como hora de Chile.
 *
 * La rama string cubre dos casos: (a) texto sin zona ("31-07-2026 22:00",
 * como vendría escrito a mano en el Excel) — mismo criterio de reinterpretar
 * como hora de pared chilena, sin pasar por `new Date(string)` que se
 * interpreta en la zona del proceso; (b) un ISO ya con zona explícita (Z o
 * ±HH:mm) — típicamente un `rawRow` ya persistido que se está re-parseando —
 * ya es un instante correcto y no debe reinterpretarse.
 */
function formatTimestamp(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) return santiagoInstant(value, value)
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim()
    if (HAS_EXPLICIT_ZONE.test(trimmed)) {
      const parsed = new Date(trimmed)
      return isNaN(parsed.getTime()) ? null : parsed.toISOString()
    }
    const match = DATE_TIME_TEXT.exec(trimmed)
    if (!match) return null
    const [, a, month, b, hour, minute, second] = match
    // El primer grupo es año si tiene 4 dígitos (formato YYYY-MM-DD); si no, es día (DD-MM-YYYY).
    const [year, day] = a!.length === 4 ? [a!, b!] : [b!, a!]
    const wall = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0)))
    if (isNaN(wall.getTime())) return null
    return santiagoInstant(wall, wall)
  }
  return null
}

/** Parser exclusivo del Excel manual TAE. No comparte ni relaja el contrato TCT. */
export async function parseTaeLegacyExcel(fileBuffer: ArrayBuffer | Buffer): Promise<TaeLegacyImportResult> {
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(fileBuffer as never) } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo Excel inválido o corrupto" }] }
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró una hoja con datos" }] }
  const records = sheetToRecords(sheet)
  const actualHeaders = new Set(Object.keys(records[0] ?? {}).map(normKey))
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !actualHeaders.has(header))
  if (missingHeaders.length) return { rows: [], errors: missingHeaders.map((field) => ({ rowIndex: 1, field, message: "Encabezado requerido no encontrado" })) }

  const rows: ParsedTaeLegacyRow[] = []
  const errors: TaeLegacyImportError[] = []
  for (let index = 0; index < records.length; index++) {
    const rawRow = records[index]!
    const rowIndex = index + 2
    const parsed = parseTaeLegacyRecord(rawRow, rowIndex)
    if (parsed.error) errors.push(parsed.error)
    else if (parsed.row) rows.push(parsed.row)
  }
  return { rows, errors }
}
