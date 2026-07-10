/**
 * Parser de archivos Excel para importación de consumos de combustible por
 * patente y periodo (reportes de tarjetas de combustible — Copec, Enex, etc.).
 * A diferencia de `import.ts` (facturas individuales con fecha por fila), esta
 * planilla resume consumos por patente para un periodo declarado por el usuario
 * al momento de subir el archivo.
 */

import ExcelJS from "exceljs"
import { normKey, sheetToRecords, parseChileanNumber } from "./xlsx-utils"

export interface ParsedConsumptionRow {
  rowIndex: number
  patente: string
  numeroTarjetas: number
  numeroTransacciones: number
  cantidadUnidad: number
  monto: number
  rendimientoPromedio: number
  rawRow: Record<string, unknown>
}

export interface ImportError {
  rowIndex: number
  field: string
  message: string
}

export interface ConsumptionImportResult {
  rows: ParsedConsumptionRow[]
  errors: ImportError[]
  duplicates: number[]   // rowIndex de patentes repetidas dentro del archivo
}

/** Normaliza una patente: trim, mayúsculas, colapsa espacios, conserva guion. */
export function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

/**
 * Parsea un archivo Excel de consumos por patente. Server-side siempre
 * (nunca se confía en filas parseadas por el cliente) — a diferencia de
 * `parseFuelExcel`, que también corre en el navegador, este parser solo se
 * invoca desde server actions, así que puede aceptar un Buffer de Node.
 */
export async function parseConsumptionExcel(fileBuffer: ArrayBuffer | Buffer): Promise<ConsumptionImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo Excel inválido o corrupto" }], duplicates: [] }
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró hoja con datos" }], duplicates: [] }

  const records = sheetToRecords(sheet)

  const rows: ParsedConsumptionRow[] = []
  const errors: ImportError[] = []
  const seenPlates = new Set<string>()
  const duplicates: number[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const rowNum = i + 2  // fila 1 = header

    const norm = new Map<string, unknown>()
    for (const [k, v] of Object.entries(record)) norm.set(normKey(k), v)
    const get = (...names: string[]): unknown => {
      for (const name of names) {
        const v = norm.get(normKey(name))
        if (v !== null && v !== undefined && v !== "") return v
      }
      return null
    }

    // Saltar filas completamente vacías
    if (!get("Patente") && !get("Monto ($)", "Monto")) continue

    const patenteRaw = String(get("Patente") ?? "").trim()
    if (!patenteRaw) {
      errors.push({ rowIndex: rowNum, field: "Patente", message: "La patente es requerida" })
      continue
    }
    const patente = normalizePlate(patenteRaw)

    const numeroTarjetas = parseChileanNumber(get("N° Tarjetas", "N Tarjetas", "Numero Tarjetas", "Tarjetas"))
    if (numeroTarjetas < 0) {
      errors.push({ rowIndex: rowNum, field: "N° Tarjetas", message: "Debe ser ≥ 0" })
      continue
    }

    const numeroTransacciones = parseChileanNumber(get("N° Transacciones", "N Transacciones", "Numero Transacciones", "Transacciones"))
    if (numeroTransacciones < 0) {
      errors.push({ rowIndex: rowNum, field: "N° Transacciones", message: "Debe ser ≥ 0" })
      continue
    }

    const cantidadUnidad = parseChileanNumber(get("Cantidad (Unidad)", "Cantidad Unidad", "Cantidad", "Litros"))
    if (cantidadUnidad < 0) {
      errors.push({ rowIndex: rowNum, field: "Cantidad (Unidad)", message: "Debe ser ≥ 0" })
      continue
    }

    const monto = parseChileanNumber(get("Monto ($)", "Monto"))
    if (monto < 0) {
      errors.push({ rowIndex: rowNum, field: "Monto ($)", message: "Debe ser ≥ 0" })
      continue
    }

    const rendimientoPromedio = parseChileanNumber(get("Rendimiento Promedio", "Rendimiento"))
    if (rendimientoPromedio < 0) {
      errors.push({ rowIndex: rowNum, field: "Rendimiento Promedio", message: "Debe ser ≥ 0" })
      continue
    }

    if (seenPlates.has(patente)) duplicates.push(rowNum)
    seenPlates.add(patente)

    rows.push({
      rowIndex: rowNum,
      patente,
      numeroTarjetas,
      numeroTransacciones,
      cantidadUnidad,
      monto,
      rendimientoPromedio,
      rawRow: record,
    })
  }

  return { rows, errors, duplicates }
}
