/**
 * Parser de archivos Excel para el log operacional de carga de combustible por
 * transacción (ej. "CONSOLIDADO COMBUSTIBLES CHOME"). A diferencia de
 * `consumption-import.ts` (consumo agregado por patente y periodo declarado
 * por el usuario), esta planilla trae **una fila por carga real** con fecha,
 * hora, horómetro/odómetro, operador, supervisor, proveedor y rendimiento ya
 * calculados por el sistema de origen.
 */

import ExcelJS from "exceljs"
import { normKey, sheetToRecords, parseChileanNumber, nullableChileanNumber, normalizePlate, parseSheetDate, plateMatchKey } from "./xlsx-utils"

export { normalizePlate, plateMatchKey }

export type MedidoPor = "km" | "hora"
export type TipoRendimiento = "km_lt" | "lt_hr"

export interface ParsedOperationRow {
  rowIndex: number
  plate: string
  code: string | null
  faenaNombre: string | null
  tipo: string | null
  marca: string | null
  modelo: string | null
  anio: number | null
  fecha: string             // "2026-01-15"
  horaCarga: string | null  // "HH:MM"
  horometro: number | null
  medidoPor: MedidoPor | null
  liters: number
  operador: string | null
  supervisor: string | null
  proveedorNombre: string | null
  precioLitro: number | null
  monto: number | null
  rendimiento: number | null
  tipoRendimiento: TipoRendimiento | null
  rawRow: Record<string, unknown>
}

export interface ImportError {
  rowIndex: number
  field: string
  message: string
}

export interface OperationsImportResult {
  rows: ParsedOperationRow[]
  errors: ImportError[]
}

export interface MatchCandidate {
  id: string
  name: string
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita tildes
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Matchea un texto crudo (FAENA, proveedor) contra una lista de catálogo por
 *  nombre: exacto primero (sin tildes/mayúsculas), y si no hay exacto, por
 *  contención — solo si es un único candidato ambiguo. Ej. "MASISA MADERAS"
 *  matchea "Masisa" por contención; "ARAUCO" con 3 candidatas queda sin
 *  match (ambigüedad real, requiere vínculo manual). */
export function matchByNameOrContains<T extends MatchCandidate>(raw: string, candidates: T[]): T | null {
  const key = normalizeForMatch(raw)
  if (!key) return null
  const exact = candidates.find((c) => normalizeForMatch(c.name) === key)
  if (exact) return exact
  const containing = candidates.filter((c) => {
    const cn = normalizeForMatch(c.name)
    return cn.includes(key) || key.includes(cn)
  })
  return containing.length === 1 ? containing[0]! : null
}

const TIPO_EQUIPO_MAP: Record<string, string> = {
  "CAMION": "camion",
  "CAMIONETA": "camioneta",
  "ESTANQUE": "estanque",
  "CARGADOR": "cargador",
  "TRACTOR": "tractor",
  "EXCAVADORA": "excavadora",
  "BULLDOZER": "bulldozer",
  "MINICARGADOR": "minicargador",
  "RETROEXCAVADORA": "retroexcavadora",
  "HIDROLAVADORA": "hidrolavadora",
  "TRACTO": "tracto",
  "STATION WAGON": "station_wagon",
  "CAMION 3/4": "camion_3_4",
}

/** Normaliza TIPO EQUIPO a los slugs de `FUEL_VEHICLE_TYPES`. Valores
 *  desconocidos o "#N/D" quedan null en vez de forzar un tipo incorrecto. */
function normalizeTipo(raw: string): string | null {
  const key = raw.trim().toUpperCase()
  return TIPO_EQUIPO_MAP[key] ?? null
}

function normalizeMedidoPor(raw: unknown): MedidoPor | null {
  const key = String(raw ?? "").trim().toUpperCase()
  if (key === "KM") return "km"
  if (key === "HORA") return "hora"
  return null
}

function normalizeTipoRendimiento(raw: unknown): TipoRendimiento | null {
  const key = String(raw ?? "").trim().toUpperCase()
  if (key === "KM/LT") return "km_lt"
  if (key === "LT/HR") return "lt_hr"
  return null
}

function formatTimeUTC(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  return `${h}:${min}`
}

function nullableText(value: unknown): string | null {
  const s = String(value ?? "").trim()
  return s && s !== "#N/D" ? s : null
}

/** Como nullableChileanNumber, pero trata "-" (usado en la planilla para
 *  "rendimiento no calculado") como ausencia de dato, no como cero. */
function nullableChileanNumberOrDash(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "-") return null
  return nullableChileanNumber(value)
}

/**
 * Parsea un archivo Excel de log operacional de combustible. Server-side
 * siempre (nunca se confía en filas parseadas por el cliente).
 */
export async function parseFuelOperationsExcel(fileBuffer: ArrayBuffer | Buffer): Promise<OperationsImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo Excel inválido o corrupto" }] }
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró hoja con datos" }] }

  const records = sheetToRecords(sheet)

  const rows: ParsedOperationRow[] = []
  const errors: ImportError[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const rowNum = i + 2 // fila 1 = header

    // Encabezados reales traen anotaciones de uso pegadas al título, ej.
    // "PATENTE\n(AUTOMATICO)" o "SUPERVISOR TURNO\n(DESPLEGABLE)". Se indexa
    // también por el título sin la anotación final para que los alias simples
    // ("Patente", "Supervisor Turno") sigan resolviendo.
    const norm = new Map<string, unknown>()
    for (const [k, v] of Object.entries(record)) {
      const nk = normKey(k)
      norm.set(nk, v)
      const stripped = nk.replace(/\s*\([^)]*\)\s*:?\s*$/, "").trim()
      if (stripped && stripped !== nk && !norm.has(stripped)) norm.set(stripped, v)
    }
    const get = (...names: string[]): unknown => {
      for (const name of names) {
        const v = norm.get(normKey(name))
        if (v !== null && v !== undefined && v !== "") return v
      }
      return null
    }

    // Saltar filas completamente vacías
    if (!get("Patente") && !get("Fecha") && !get("LT")) continue

    const plateRaw = String(get("Patente") ?? "").trim()
    if (!plateRaw) {
      errors.push({ rowIndex: rowNum, field: "Patente", message: "La patente es requerida" })
      continue
    }
    const plate = normalizePlate(plateRaw)

    // `parseSheetDate` y no `new Date(texto)`: éste lee mm/dd y corría de mes
    // las fechas chilenas de los días 1-12 sin dejar rastro.
    const fecha = parseSheetDate(get("Fecha"))
    if (!fecha) {
      errors.push({ rowIndex: rowNum, field: "Fecha", message: "Fecha requerida o inválida" })
      continue
    }

    const rawHora = get("Hora Carga", "Hora")
    const horaCarga = rawHora instanceof Date ? formatTimeUTC(rawHora) : null

    const liters = parseChileanNumber(get("LT", "Litros"))
    if (liters < 0) {
      errors.push({ rowIndex: rowNum, field: "LT", message: "Debe ser ≥ 0" })
      continue
    }

    const anioRaw = nullableChileanNumber(get("Año", "Ano", "AÑO"))
    const anio = anioRaw && anioRaw > 0 ? anioRaw : null

    const tipoRaw = get("Tipo Equipo", "Tipo")
    const tipo = tipoRaw ? normalizeTipo(String(tipoRaw)) : null

    rows.push({
      rowIndex: rowNum,
      plate,
      code: nullableText(get("Codigo", "Código")),
      faenaNombre: nullableText(get("Faena")),
      tipo,
      marca: nullableText(get("Marca")),
      modelo: nullableText(get("Modelo")),
      anio,
      fecha,
      horaCarga,
      horometro: nullableChileanNumber(get("Horometro / Odometro", "Horometro", "Odometro", "Horómetro")),
      medidoPor: normalizeMedidoPor(get("Medido Por Hora O Km", "Medido Por")),
      liters,
      operador: nullableText(get("Operador Conductor", "Operador", "Conductor")),
      supervisor: nullableText(get("Supervisor Turno", "Supervisor")),
      proveedorNombre: nullableText(get("Suministro Entregado Por:", "Suministro Entregado Por", "Proveedor")),
      precioLitro: nullableChileanNumber(get("$/lt", "$/Lt", "Precio Litro")),
      monto: nullableChileanNumber(get("Monto ($)", "Monto")),
      rendimiento: nullableChileanNumberOrDash(get("Rendimiento")),
      tipoRendimiento: normalizeTipoRendimiento(get("Tipo De Rendimiento")),
      rawRow: record,
    })
  }

  return { rows, errors }
}
