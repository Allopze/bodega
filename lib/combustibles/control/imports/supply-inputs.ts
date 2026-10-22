/**
 * Importador de entradas de surtidor o tarjeta (supuesto S-2): una fila por
 * despacho de un medio sin integración. El medio lo elige quien importa; la
 * llave de idempotencia es (medio, referencia).
 */
import { santiagoInstant } from "@/lib/combustibles/xlsx-utils"
import { todayInChile } from "@/lib/utils"
import {
  readDateCell,
  readNumberCell,
  readSheetRows,
  readTimeCell,
  roundTo,
  textCell,
  type ColumnSpec,
  type ImportRowIssue,
  type RawRow,
  type VehicleLookup,
  type WorksiteLookup,
} from "./shared"
import type { ParseResult } from "./telemetry"

export const SUPPLY_INPUT_COLUMNS: ColumnSpec[] = [
  { key: "day", headers: ["Fecha"], required: true },
  { key: "time", headers: ["Hora"], required: false },
  { key: "worksite", headers: ["Faena"], required: true },
  { key: "liters", headers: ["Litros", "LT"], required: true },
  { key: "reference", headers: ["Referencia", "Guía", "Folio"], required: true },
  { key: "target", headers: ["Patente o estanque", "Patente", "Estanque"], required: false },
]

export const MAX_REFERENCE_LENGTH = 120

export interface ParsedSupplyRow {
  rowIndex: number
  day: string
  occurredAt: string
  worksite: string
  liters: number
  reference: string
  target: string
  rawRow: RawRow
}

/** La referencia se compara sin distinguir mayúsculas ni espacios de más: «g-123» y «G-123» es la misma guía. */
export function normalizeReference(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase()
}

export async function parseSupplyInputsWorkbook(buffer: Uint8Array): Promise<ParseResult<ParsedSupplyRow>> {
  const sheet = await readSheetRows(buffer, SUPPLY_INPUT_COLUMNS)
  if (sheet.fileIssue) return { rows: [], issues: [], totalRows: 0, rawRows: new Map(), fileIssue: sheet.fileIssue }
  if (sheet.missing.length > 0) {
    return { rows: [], issues: [], totalRows: 0, rawRows: new Map(), fileIssue: `Faltan columnas obligatorias: ${sheet.missing.join(", ")}. Descarga la plantilla para ver los encabezados exactos.` }
  }

  const today = todayInChile()
  const rows: ParsedSupplyRow[] = []
  const issues: ImportRowIssue[] = []

  for (const { rowIndex, values, raw } of sheet.rows) {
    const rowIssues: ImportRowIssue[] = []
    const fail = (field: string, message: string) => rowIssues.push({ rowIndex, field, message })

    const day = readDateCell(values.day)
    if (day.status === "empty") fail("Fecha", "la fecha es obligatoria")
    else if (day.status === "invalid") fail("Fecha", day.message)
    else if (day.day > today) fail("Fecha", "la fecha es futura")

    const time = readTimeCell(values.time)
    if (time.status === "invalid") fail("Hora", "no es una hora válida (usa HH:MM)")

    const worksite = textCell(values.worksite)
    if (!worksite) fail("Faena", "la faena es obligatoria")

    const litersCell = readNumberCell(values.liters)
    let liters = 0
    if (litersCell.status === "empty") fail("Litros", "los litros son obligatorios")
    else if (litersCell.status === "invalid") fail("Litros", litersCell.message)
    else if (litersCell.value <= 0) fail("Litros", "deben ser mayores que cero")
    else liters = litersCell.value

    const reference = normalizeReference(textCell(values.reference))
    if (!reference) fail("Referencia", "la guía o folio es obligatoria: es lo que evita duplicar el despacho al reimportar")
    else if (reference.length > MAX_REFERENCE_LENGTH) fail("Referencia", `no puede superar ${MAX_REFERENCE_LENGTH} caracteres`)

    if (rowIssues.length > 0) {
      issues.push(...rowIssues)
      continue
    }
    const plainDay = (day as { day: string }).day
    const [year, month, date] = plainDay.split("-").map(Number)
    const dayDate = new Date(Date.UTC(year!, month! - 1, date!))
    const timeDate = time.status === "value" ? new Date(Date.UTC(1970, 0, 1, time.hours, time.minutes)) : null
    rows.push({
      rowIndex,
      day: plainDay,
      occurredAt: santiagoInstant(dayDate, timeDate),
      worksite,
      liters: roundTo(liters, 4),
      reference,
      target: textCell(values.target),
      rawRow: raw,
    })
  }
  return { rows, issues, totalRows: sheet.rows.length, rawRows: new Map(sheet.rows.map((row) => [row.rowIndex, row.raw])) }
}

export interface ResolvedSupplyRow extends ParsedSupplyRow {
  worksiteId: string
  vehicleId: string | null
  month: string
}

/**
 * Resuelve faena (por nombre o código) y, si viene, el equipo. Una patente que
 * no está en el catálogo NO rechaza la fila (el campo es opcional y puede ser un
 * estanque): el despacho se importa sin equipo asociado. Faena desconocida,
 * fuera de alcance o referencia repetida en el archivo sí rechazan.
 */
export function resolveSupplyRows(
  rows: ParsedSupplyRow[],
  findWorksite: (token: string) => WorksiteLookup,
  findVehicle: (token: string) => VehicleLookup,
  canAccessWorksite: (worksiteId: string) => boolean,
): { valid: ResolvedSupplyRow[]; issues: ImportRowIssue[] } {
  const valid: ResolvedSupplyRow[] = []
  const issues: ImportRowIssue[] = []
  const firstByReference = new Map<string, number>()
  for (const row of rows) {
    const found = findWorksite(row.worksite)
    if (found.status === "unknown") {
      issues.push({ rowIndex: row.rowIndex, field: "Faena", message: `«${row.worksite}» no es una faena de la plataforma (usa el nombre o el código)` })
      continue
    }
    if (found.status === "ambiguous") {
      issues.push({ rowIndex: row.rowIndex, field: "Faena", message: `«${row.worksite}» corresponde a más de una faena; usa el código` })
      continue
    }
    if (!canAccessWorksite(found.worksite.id)) {
      issues.push({ rowIndex: row.rowIndex, field: "Faena", message: `«${row.worksite}» está fuera de tu alcance de faenas` })
      continue
    }
    const first = firstByReference.get(row.reference)
    if (first !== undefined) {
      issues.push({ rowIndex: row.rowIndex, field: "Referencia", message: `la referencia ya aparece en la fila ${first}; cada guía o folio debe ir una sola vez` })
      continue
    }
    firstByReference.set(row.reference, row.rowIndex)
    const vehicle = row.target ? findVehicle(row.target) : { status: "unknown" as const }
    valid.push({
      ...row,
      worksiteId: found.worksite.id,
      vehicleId: vehicle.status === "found" ? vehicle.vehicle.id : null,
      month: row.day.slice(0, 7),
    })
  }
  return { valid, issues }
}
