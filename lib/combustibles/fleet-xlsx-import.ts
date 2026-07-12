/**
 * Parser for the fleet snapshot exported as "CONSOLIDADO COMBUSTIBLES CHOME".
 *
 * This workbook is a vehicle catalogue, not a fuel-transaction log. The
 * importer deliberately uses the vehicle-identifying fields only: code,
 * plate, worksite, type, brand, model and year. Odometer/hour-meter, unit and
 * supplier are operational snapshots and must not overwrite fleet master data.
 */

import ExcelJS from "exceljs"
import { canonicalFuelVehicleType } from "./validation"
import { normKey, sheetToRecords } from "./xlsx-utils"

export interface FleetXlsxRow {
  rowIndex: number
  plate: string
  code: string | null
  worksiteName: string
  type: string
  brand: string | null
  model: string | null
  year: number | null
}

export interface FleetXlsxError {
  rowIndex: number
  field: string
  message: string
}

export interface FleetXlsxImportResult {
  rows: FleetXlsxRow[]
  errors: FleetXlsxError[]
}

const REQUIRED_HEADERS = ["CODIGO", "PATENTE", "FAENA", "TIPO", "MARCA", "MODELO", "AÑO"]

function text(value: unknown): string | null {
  const result = String(value ?? "").trim()
  return result && result !== "#N/D" ? result : null
}

function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "")
}

function normalizeYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const year = Number(value)
  return Number.isInteger(year) && year >= 1990 && year <= 2030 ? year : null
}

/** Reads the first worksheet of the supported Chome fleet workbook. */
export async function parseFleetXlsx(fileBuffer: ArrayBuffer | Buffer): Promise<FleetXlsxImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo XLSX inválido o corrupto" }] }
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró una hoja con datos" }] }

  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = normKey(String(cell.value ?? ""))
  })
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(normKey(header)))
  if (missingHeaders.length > 0) {
    return { rows: [], errors: [{ rowIndex: 1, field: "encabezados", message: `Faltan columnas requeridas: ${missingHeaders.join(", ")}` }] }
  }

  const rows: FleetXlsxRow[] = []
  const errors: FleetXlsxError[] = []
  const seenPlates = new Set<string>()

  for (const [index, record] of sheetToRecords(sheet).entries()) {
    const rowIndex = index + 2
    const normalized = new Map<string, unknown>(Object.entries(record).map(([key, value]) => [normKey(key), value]))
    const get = (name: string) => normalized.get(normKey(name))
    const plateRaw = text(get("PATENTE"))
    const worksiteName = text(get("FAENA"))
    const rawType = text(get("TIPO"))

    if (!plateRaw && !worksiteName && !rawType) continue
    if (!plateRaw) { errors.push({ rowIndex, field: "PATENTE", message: "La patente es requerida" }); continue }
    if (!worksiteName) { errors.push({ rowIndex, field: "FAENA", message: "La faena es requerida" }); continue }
    if (!rawType) { errors.push({ rowIndex, field: "TIPO", message: "El tipo es requerido" }); continue }

    const plate = normalizePlate(plateRaw)
    if (seenPlates.has(plate)) { errors.push({ rowIndex, field: "PATENTE", message: `Patente duplicada en el archivo: ${plate}` }); continue }
    seenPlates.add(plate)

    const rawYear = get("AÑO")
    const year = normalizeYear(rawYear)
    if (rawYear !== null && rawYear !== undefined && rawYear !== "" && year === null) {
      errors.push({ rowIndex, field: "AÑO", message: "Debe ser un año entre 1990 y 2030" })
      continue
    }

    rows.push({
      rowIndex,
      plate,
      code: text(get("CODIGO")),
      worksiteName,
      type: canonicalFuelVehicleType(rawType) ?? rawType.toLocaleLowerCase("es-CL"),
      brand: text(get("MARCA")),
      model: text(get("MODELO")),
      year,
    })
  }

  return { rows, errors }
}
