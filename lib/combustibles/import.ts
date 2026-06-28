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
  odometerReading?: number | null
  hourMeterReading?: number | null
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

    // Acceso por nombre de columna normalizado: tolera mayúsculas, tildes,
    // espacios sobrantes y saltos de línea (\r\n) dentro de los encabezados
    // del Excel (p.ej. " TOTAL FACTURA A PAGAR " o "IMPUESTO IEC\n(FIJO...)").
    const norm = new Map<string, unknown>()
    for (const [k, v] of Object.entries(row)) norm.set(normKey(k), v)
    const get = (name: string): unknown => norm.get(normKey(name)) ?? null

    // Saltar filas completamente vacías
    if (!get("MES-AÑO") && !get("SERVICIO") && !get("FACTURA")) continue

    // Parsear fecha
    const rawDate = get("MES-AÑO")
    let loadDate = ""
    let month = ""
    if (rawDate instanceof Date) {
      const y = rawDate.getFullYear()
      const m = String(rawDate.getMonth() + 1).padStart(2, "0")
      const d = String(rawDate.getDate()).padStart(2, "0")
      loadDate = `${y}-${m}-${d}`
      month = `${y}-${m}`
    } else if (typeof rawDate === "string" && rawDate.trim()) {
      // Intentar parsear string
      const d = new Date(rawDate)
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear()
        const mo = String(d.getMonth() + 1).padStart(2, "0")
        const da = String(d.getDate()).padStart(2, "0")
        loadDate = `${y}-${mo}-${da}`
        month = `${y}-${mo}`
      } else {
        errors.push({ rowIndex: rowNum, field: "MES-AÑO", message: `Fecha inválida: ${rawDate}` })
        continue
      }
    } else {
      errors.push({ rowIndex: rowNum, field: "MES-AÑO", message: "Fecha requerida" })
      continue
    }

    // Campos texto
    const serviceType = String(get("SERVICIO") ?? "").trim().toUpperCase()
    if (!["TCT", "TAE"].includes(serviceType)) {
      errors.push({ rowIndex: rowNum, field: "SERVICIO", message: `Servicio inválido: ${serviceType}` })
      continue
    }

    const vehicle = String(get("VEHICULO") ?? "").trim()
    const supplier = String(get("PROVEEDOR") ?? "").trim()
    const worksite = String(get("FAENA") ?? "").trim()
    const product = String(get("PRODUCTO") ?? "").trim().toUpperCase()
    const receiptNumber = String(get("FACTURA") ?? "").trim()
    const odometerReading = nullableNumber(get("KILOMETRAJE") ?? get("KM") ?? get("ODOMETRO"))
    const hourMeterReading = nullableNumber(get("HOROMETRO") ?? get("HORÓMETRO") ?? get("HRS") ?? get("HORAS"))

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
    const liters = toNumber(get("LITROS"))
    const iecFixed = toNumber(get("IEC Fijo"))
    const iecVariable = toNumber(get("IEC Variable"))
    const baseAmount = toNumber(get("Base Afecta"))
    const iecTotal = toNumber(get("IMPUESTO IEC (FIJO + VARIIABLE)") ?? get("IMPUESTO IEC"))
    const ivaAmount = toNumber(get("IVA (19%)") ?? get("IVA"))
    const totalAmount = toNumber(get("TOTAL FACTURA A PAGAR") ?? get("TOTAL FACTURA"))

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
      odometerReading,
      hourMeterReading,
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

/** Normaliza un encabezado de columna: colapsa espacios/saltos de línea,
 *  recorta y pasa a minúsculas, para comparar de forma tolerante. */
function normKey(key: string): string {
  return key.replace(/\s+/g, " ").trim().toLowerCase()
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[,.](?=\d{3})/g, "").replace(",", "."))
    return isNaN(n) ? 0 : n
  }
  return 0
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = toNumber(value)
  return Number.isFinite(parsed) ? parsed : null
}
