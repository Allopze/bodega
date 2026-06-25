/**
 * Parser de archivos Excel para importación de cargas de combustible.
 * Formato esperado: hoja "BASE DE DATOS" o primera hoja con datos.
 * Basado en el Excel "CONTROL FACTURAS COMBUSTIBLES" de TCT Copec.
 */

import * as XLSX from "xlsx"

export interface ParsedFuelLoad {
  rowIndex: number
  loadDate: string            // "2026-01-15"
  month: string               // "2026-01"
  serviceType: string         // TCT | TAE
  vehicle: string             // Nombre del vehículo (para matching)
  supplier: string            // Nombre del proveedor (para matching)
  worksite: string            // Nombre de la faena (para matching)
  product: string             // PETROLEO DIESEL | BLUEMAX
  receiptNumber: string       // Nro factura/boleta
  liters: number
  iecFixed: number
  iecVariable: number
  baseAmount: number
  iecTotal: number
  ivaAmount: number
  totalAmount: number
}

export interface ImportError {
  rowIndex: number
  field: string
  message: string
}

export interface ImportResult {
  loads: ParsedFuelLoad[]
  errors: ImportError[]
  duplicates: number[]        // rowIndex de duplicados
}

/**
 * Parsea un archivo Excel y extrae las cargas de combustible.
 */
export function parseFuelExcel(fileBuffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(fileBuffer, { type: "array", cellDates: true })

  // Buscar hoja "BASE DE DATOS" o la primera con datos
  const sheetName = wb.SheetNames.find(n => n.toUpperCase().includes("BASE"))
    ?? wb.SheetNames[0]
  if (!sheetName) return { loads: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró hoja con datos" }], duplicates: [] }

  const ws = wb.Sheets[sheetName]
  if (!ws) return { loads: [], errors: [{ rowIndex: 0, field: "file", message: "Hoja vacía" }], duplicates: [] }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })

  const loads: ParsedFuelLoad[] = []
  const errors: ImportError[] = []
  const seenReceipts = new Set<string>()
  const duplicates: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const rowNum = i + 2  // +2 porque fila 1 es header, índice parte en 0

    // Saltar filas completamente vacías
    if (!row["MES-AÑO"] && !row["SERVICIO"] && !row["FACTURA"]) continue

    // Parsear fecha
    const rawDate = row["MES-AÑO"]
    let loadDate = ""
    let month = ""
    if (rawDate instanceof Date) {
      loadDate = rawDate.toISOString().split("T")[0]!
      month = loadDate.substring(0, 7)
    } else if (typeof rawDate === "string" && rawDate.trim()) {
      // Intentar parsear string
      const d = new Date(rawDate)
      if (!isNaN(d.getTime())) {
        loadDate = d.toISOString().split("T")[0]!
        month = loadDate.substring(0, 7)
      } else {
        errors.push({ rowIndex: rowNum, field: "MES-AÑO", message: `Fecha inválida: ${rawDate}` })
        continue
      }
    } else {
      errors.push({ rowIndex: rowNum, field: "MES-AÑO", message: "Fecha requerida" })
      continue
    }

    // Campos texto
    const serviceType = String(row["SERVICIO"] ?? "").trim().toUpperCase()
    if (!["TCT", "TAE"].includes(serviceType)) {
      errors.push({ rowIndex: rowNum, field: "SERVICIO", message: `Servicio inválido: ${serviceType}` })
      continue
    }

    const vehicle = String(row["VEHICULO"] ?? "").trim()
    const supplier = String(row["PROVEEDOR"] ?? "").trim()
    const worksite = String(row["FAENA"] ?? "").trim()
    const product = String(row["PRODUCTO"] ?? "").trim().toUpperCase()
    const receiptNumber = String(row["FACTURA"] ?? "").trim()

    // Validar campos requeridos
    if (!vehicle) { errors.push({ rowIndex: rowNum, field: "VEHICULO", message: "Requerido" }); continue }
    if (!supplier) { errors.push({ rowIndex: rowNum, field: "PROVEEDOR", message: "Requerido" }); continue }
    if (!worksite) { errors.push({ rowIndex: rowNum, field: "FAENA", message: "Requerido" }); continue }
    if (!product) { errors.push({ rowIndex: rowNum, field: "PRODUCTO", message: "Requerido" }); continue }

    // Duplicados por nro factura
    if (receiptNumber && seenReceipts.has(receiptNumber)) {
      duplicates.push(rowNum)
    }
    if (receiptNumber) seenReceipts.add(receiptNumber)

    // Campos numéricos
    const liters = toNumber(row["LITROS"])
    const iecFixed = toNumber(row[" IEC Fijo"] ?? row["IEC Fijo"])
    const iecVariable = toNumber(row[" IEC Variable"] ?? row["IEC Variable"])
    const baseAmount = toNumber(row["Base Afecta"])
    const iecTotal = toNumber(row["IMPUESTO IEC\n(FIJO + VARIIABLE)"] ?? row["IMPUESTO IEC"])
    const ivaAmount = toNumber(row["IVA (19%)"] ?? row["IVA"])
    const totalAmount = toNumber(row["TOTAL FACTURA A PAGAR"] ?? row["TOTAL FACTURA"])

    if (liters < 0) { errors.push({ rowIndex: rowNum, field: "LITROS", message: "Debe ser ≥ 0" }); continue }
    if (baseAmount <= 0) { errors.push({ rowIndex: rowNum, field: "Base Afecta", message: "Debe ser > 0" }); continue }

    loads.push({
      rowIndex: rowNum,
      loadDate,
      month,
      serviceType,
      vehicle,
      supplier,
      worksite,
      product,
      receiptNumber,
      liters,
      iecFixed,
      iecVariable,
      baseAmount,
      iecTotal,
      ivaAmount,
      totalAmount,
    })
  }

  return { loads, errors, duplicates }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[,.](?=\d{3})/g, "").replace(",", "."))
    return isNaN(n) ? 0 : n
  }
  return 0
}
