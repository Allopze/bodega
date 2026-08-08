/**
 * Parser de archivos Excel para importación de consumos de combustible por
 * patente y periodo (reportes de tarjetas de combustible — Copec, Enex, etc.).
 * A diferencia de `import.ts` (facturas individuales con fecha por fila), esta
 * planilla resume consumos por patente para un periodo declarado por el usuario
 * al momento de subir el archivo.
 */

import ExcelJS from "exceljs"
import { normKey, sheetToRecords, parseChileanNumber, normalizePlate } from "./xlsx-utils"

export { normalizePlate }

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

function normalizedRecord(record: Record<string, unknown>) {
  const norm = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) norm.set(normKey(key), value)
  return (...names: string[]): unknown => {
    for (const name of names) {
      const value = norm.get(normKey(name))
      if (value !== null && value !== undefined && value !== "") return value
    }
    return null
  }
}

function isCopecDetail(records: Record<string, unknown>[]) {
  return records.some((record) => {
    const keys = new Set(Object.keys(record).map(normKey))
    return keys.has(normKey("Fecha Transacción")) && keys.has(normKey("Tarjeta")) && keys.has(normKey("Volumen"))
  })
}

function parseCopecDetail(records: Record<string, unknown>[]): ConsumptionImportResult {
  const errors: ImportError[] = []
  const groups = new Map<string, {
    rowIndex: number
    cards: Set<string>
    transactions: Record<string, unknown>[]
    quantity: number
    amount: number
    weightedPerformance: number
    performanceQuantity: number
  }>()

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    const rowIndex = index + 2
    const get = normalizedRecord(record)
    const patente = normalizePlate(String(get("Patente") ?? ""))
    if (!patente) {
      errors.push({ rowIndex, field: "Patente", message: "La patente es requerida" })
      continue
    }

    const quantity = parseChileanNumber(get("Volumen", "Cantidad (Unidad)", "Cantidad", "Litros"))
    const amount = parseChileanNumber(get("Monto ($)", "Monto"))
    const performance = parseChileanNumber(get("Rendimiento (Kms. por Litro)", "Rendimiento Promedio", "Rendimiento"))
    if (quantity < 0 || amount < 0 || performance < 0) {
      errors.push({ rowIndex, field: quantity < 0 ? "Volumen" : amount < 0 ? "Monto ($)" : "Rendimiento", message: "Debe ser ≥ 0" })
      continue
    }

    const group = groups.get(patente) ?? {
      rowIndex,
      cards: new Set<string>(),
      transactions: [],
      quantity: 0,
      amount: 0,
      weightedPerformance: 0,
      performanceQuantity: 0,
    }
    const card = String(get("Tarjeta", "N° Tarjeta", "Numero Tarjeta") ?? "").trim()
    if (card) group.cards.add(card)
    group.transactions.push(record)
    group.quantity += quantity
    group.amount += amount
    if (performance > 0 && quantity > 0) {
      group.weightedPerformance += performance * quantity
      group.performanceQuantity += quantity
    }
    groups.set(patente, group)
  }

  const rows = [...groups.entries()].map(([patente, group]): ParsedConsumptionRow => ({
    rowIndex: group.rowIndex,
    patente,
    numeroTarjetas: group.cards.size,
    numeroTransacciones: group.transactions.length,
    cantidadUnidad: Math.round(group.quantity * 10_000) / 10_000,
    monto: Math.round(group.amount * 100) / 100,
    rendimientoPromedio: group.performanceQuantity > 0
      ? Math.round((group.weightedPerformance / group.performanceQuantity) * 100) / 100
      : 0,
    rawRow: { detalle: group.transactions },
  }))

  return { rows, errors, duplicates: [] }
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

  // "Descargar Detalle" trae una fila por transacción. El modelo interno guarda
  // un consolidado por patente y mes, por eso agregamos tarjetas, transacciones,
  // litros, monto y rendimiento antes de importar.
  if (isCopecDetail(records)) return parseCopecDetail(records)

  const rows: ParsedConsumptionRow[] = []
  const errors: ImportError[] = []
  const seenPlates = new Set<string>()
  const duplicates: number[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const rowNum = i + 2  // fila 1 = header

    const get = normalizedRecord(record)

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
