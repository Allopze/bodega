/**
 * Importador de telemetría diaria (supuesto S-1): una fila por equipo y día con
 * horas de funcionamiento, horas en vacío y, si la fuente las trae, litros.
 * El % de ralentí NO se importa: se calcula siempre desde las horas crudas.
 */
import { todayInChile } from "@/lib/utils"
import {
  readDateCell,
  readNumberCell,
  readSheetRows,
  roundTo,
  textCell,
  type ColumnSpec,
  type ImportRowIssue,
  type IndexedVehicle,
  type RawRow,
  type VehicleLookup,
} from "./shared"

export const TELEMETRY_COLUMNS: ColumnSpec[] = [
  { key: "equipment", headers: ["Equipo", "Código", "Patente"], required: true },
  { key: "day", headers: ["Fecha", "Día"], required: true },
  { key: "operatingHours", headers: ["Horas funcionamiento", "Horas de funcionamiento", "Horas operación"], required: true },
  { key: "idleHours", headers: ["Horas en vacío", "Horas en vacio", "Horas ralentí", "Horas ralenti"], required: true },
  { key: "litersWorking", headers: ["Litros trabajando"], required: false },
  { key: "litersIdle", headers: ["Litros en vacío", "Litros en vacio", "Litros ralentí", "Litros ralenti"], required: false },
  { key: "litersTotal", headers: ["Litros totales", "Litros total"], required: false },
]

export interface ParsedTelemetryRow {
  rowIndex: number
  equipment: string
  day: string
  operatingHours: number
  idleHours: number
  litersWorking: number | null
  litersIdle: number | null
  rawRow: RawRow
}

export interface ParseResult<T> {
  rows: T[]
  issues: ImportRowIssue[]
  /** Filas con datos leídas del archivo (válidas + rechazadas). */
  totalRows: number
  /** Contenido original de cada fila por número de fila, para guardar los rechazos. */
  rawRows: Map<number, RawRow>
  fileIssue?: string
}

/** Fuente de la telemetría como slug en minúsculas: «VisionLink» → «visionlink». */
export function normalizeSourceSlug(source: string): string {
  return source
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export const DEFAULT_TELEMETRY_SOURCE = "VisionLink"

export async function parseTelemetryWorkbook(buffer: Uint8Array): Promise<ParseResult<ParsedTelemetryRow>> {
  const sheet = await readSheetRows(buffer, TELEMETRY_COLUMNS)
  if (sheet.fileIssue) return { rows: [], issues: [], totalRows: 0, rawRows: new Map(), fileIssue: sheet.fileIssue }
  if (sheet.missing.length > 0) {
    return { rows: [], issues: [], totalRows: 0, rawRows: new Map(), fileIssue: `Faltan columnas obligatorias: ${sheet.missing.join(", ")}. Descarga la plantilla para ver los encabezados exactos.` }
  }

  const today = todayInChile()
  const rows: ParsedTelemetryRow[] = []
  const issues: ImportRowIssue[] = []

  for (const { rowIndex, values, raw } of sheet.rows) {
    const rowIssues: ImportRowIssue[] = []
    const fail = (field: string, message: string) => rowIssues.push({ rowIndex, field, message })

    const equipment = textCell(values.equipment)
    if (!equipment) fail("Equipo", "el equipo es obligatorio (código interno o patente)")

    const day = readDateCell(values.day)
    if (day.status === "empty") fail("Fecha", "la fecha es obligatoria")
    else if (day.status === "invalid") fail("Fecha", day.message)
    else if (day.day > today) fail("Fecha", "la fecha es futura: la telemetría solo informa días ya ocurridos")

    const number = (field: string, key: string, required: boolean) => {
      const cell = readNumberCell(values[key])
      if (cell.status === "empty") {
        if (required) fail(field, "es obligatorio")
        return null
      }
      if (cell.status === "invalid") {
        fail(field, cell.message)
        return null
      }
      if (cell.value < 0) {
        fail(field, "no puede ser negativo")
        return null
      }
      return cell.value
    }
    const operating = number("Horas funcionamiento", "operatingHours", true)
    const idle = number("Horas en vacío", "idleHours", true)
    const working = number("Litros trabajando", "litersWorking", false)
    const litersIdle = number("Litros en vacío", "litersIdle", false)
    const total = number("Litros totales", "litersTotal", false)

    if (operating !== null && operating > 24) fail("Horas funcionamiento", "un equipo no puede funcionar más de 24 horas en un día")
    if (operating !== null && idle !== null && idle > operating) fail("Horas en vacío", "las horas en vacío no pueden superar las horas de funcionamiento")

    let litersWorking = working
    if (working !== null && total !== null) fail("Litros totales", "informa litros trabajando o litros totales, no ambos")
    else if (working === null && total !== null) {
      if (litersIdle === null) fail("Litros totales", "para derivar los litros trabajando (total − vacío) falta la columna «Litros en vacío»")
      else if (litersIdle > total) fail("Litros en vacío", "los litros en vacío no pueden superar los litros totales")
      else litersWorking = roundTo(total - litersIdle, 4)
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues)
      continue
    }
    rows.push({
      rowIndex,
      equipment,
      day: (day as { day: string }).day,
      operatingHours: roundTo(operating!, 2),
      idleHours: roundTo(idle!, 2),
      litersWorking: litersWorking === null ? null : roundTo(litersWorking, 4),
      litersIdle: litersIdle === null ? null : roundTo(litersIdle, 4),
      rawRow: raw,
    })
  }
  return { rows, issues, totalRows: sheet.rows.length, rawRows: new Map(sheet.rows.map((row) => [row.rowIndex, row.raw])) }
}

export interface ResolvedTelemetryRow extends ParsedTelemetryRow {
  vehicleId: string
  worksiteId: string
  month: string
}

/**
 * Asocia cada fila a su equipo y descarta lo que no se puede importar: equipo
 * desconocido o ambiguo, fuera del alcance de faenas del usuario y el mismo
 * equipo y día repetido (un `INSERT … ON CONFLICT` no puede tocar la misma fila
 * dos veces, y de todos modos no hay forma de saber cuál de las dos es la buena).
 */
export function resolveTelemetryRows(
  rows: ParsedTelemetryRow[],
  find: (token: string) => VehicleLookup,
  canAccessWorksite: (worksiteId: string) => boolean,
): { valid: ResolvedTelemetryRow[]; issues: ImportRowIssue[] } {
  const valid: ResolvedTelemetryRow[] = []
  const issues: ImportRowIssue[] = []
  const firstByKey = new Map<string, number>()
  for (const row of rows) {
    const found = find(row.equipment)
    if (found.status === "unknown") {
      issues.push({ rowIndex: row.rowIndex, field: "Equipo", message: `«${row.equipment}» no está en el catálogo de equipos (busca por código interno o patente)` })
      continue
    }
    if (found.status === "ambiguous") {
      issues.push({ rowIndex: row.rowIndex, field: "Equipo", message: `«${row.equipment}» corresponde a más de un equipo del catálogo; usa la patente completa` })
      continue
    }
    const vehicle: IndexedVehicle = found.vehicle
    if (!canAccessWorksite(vehicle.worksiteId)) {
      issues.push({ rowIndex: row.rowIndex, field: "Equipo", message: `«${row.equipment}» pertenece a una faena fuera de tu alcance` })
      continue
    }
    const key = `${vehicle.id}|${row.day}`
    const first = firstByKey.get(key)
    if (first !== undefined) {
      issues.push({ rowIndex: row.rowIndex, field: "Fecha", message: `el equipo ya aparece ese día en la fila ${first}; deja una sola fila por equipo y día` })
      continue
    }
    firstByKey.set(key, row.rowIndex)
    valid.push({ ...row, vehicleId: vehicle.id, worksiteId: vehicle.worksiteId, month: row.day.slice(0, 7) })
  }
  return { valid, issues }
}
