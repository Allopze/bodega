/**
 * Parser del informe TAE de Copec: el detalle de cada carga que una vasija propia
 * (camión o camioneta estanque) hace EN una estación de servicio, antes de salir a
 * repartir en faena. Es la etapa `received` del ciclo físico.
 *
 * No comparte contrato con `consumption-import.ts` (canal TCT): aquel resume el
 * consumo por patente en un período, éste trae una fila por transacción y no tiene
 * columna de patente — la vasija se identifica por número de tarjeta.
 */

import ExcelJS from "exceljs"
import { normKey, sheetToRecords, parseExactChileanDecimal, parseSheetDate, santiagoInstant, isCopecCardOfChannel } from "./xlsx-utils"
import { withoutPersonalData } from "./meter-readings"
import { FUEL_PRODUCT_IDS, fuelProductIdForLegacy } from "./fuel-products"

export interface ParsedTaeReceiptRow {
  rowIndex: number
  /** Guía de despacho: única por transacción. Es la clave de idempotencia. */
  documentNumber: string
  cardNumber: string
  assignment: string
  productId: string
  sourceDate: string
  occurredAt: string
  liters: number
  unitPrice: number | null
  amount: number
  station: string
  rawRow: Record<string, unknown>
}

export interface TaeReceiptImportError {
  rowIndex: number
  field: string
  message: string
  rawRow?: Record<string, unknown>
}

export interface TaeReceiptImportResult {
  rows: ParsedTaeReceiptRow[]
  errors: TaeReceiptImportError[]
}

function asDate(value: unknown): Date | null {
  // Las celdas de hora de Excel llegan como Date con una fecha base de 1899;
  // conservar sus componentes de hora para `santiagoInstant`.
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const civilDate = parseSheetDate(value)
  return civilDate ? new Date(`${civilDate}T00:00:00.000Z`) : null
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  const raw = String(value).trim()
  return raw === "-" ? "" : raw
}

function reader(record: Record<string, unknown>) {
  const byKey = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) byKey.set(normKey(key), value)
  return (...names: string[]): unknown => {
    for (const name of names) {
      const value = byKey.get(normKey(name))
      if (value !== undefined && value !== null && value !== "") return value
    }
    return null
  }
}

export async function parseTaeReceiptExcel(buffer: Buffer, context?: { from: string; to: string; expectedProduct?: "diesel" | "bluemax" }): Promise<TaeReceiptImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "archivo", message: "Archivo Excel inválido o corrupto" }] }
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "archivo", message: "El archivo no tiene hojas" }] }

  const rows: ParsedTaeReceiptRow[] = []
  const errors: TaeReceiptImportError[] = []
  const seen = new Set<string>()

  sheetToRecords(sheet).forEach((record, index) => {
    const rowIndex = record.__row ?? index + 2 // fila 1 = encabezados; conserva filas vacías intercaladas
    const get = reader(record)
    const fail = (field: string, message: string) => errors.push({ rowIndex, field, message, rawRow: withoutPersonalData(record) })

    // El canal se elige en el portal, pero el archivo lo declara por fila. Si una
    // fila no es TAE, el informe descargado no es el que creemos: no la adivinamos.
    const cardType = text(get("Tipo de Tarjeta"))
    if (!isCopecCardOfChannel(cardType, "TAE")) {
      fail("Tipo de Tarjeta", `Se esperaba una fila TAE y llegó "${cardType || "vacío"}"`)
      return
    }

    const documentNumber = text(get("Guía de Despacho"))
    if (!documentNumber) { fail("Guía de Despacho", "Falta la guía de despacho"); return }
    if (seen.has(documentNumber)) { fail("Guía de Despacho", `Guía ${documentNumber} repetida dentro del archivo`); return }

    const cardNumber = text(get("Tarjeta"))
    if (!cardNumber) { fail("Tarjeta", "Falta el número de tarjeta"); return }

    const date = asDate(get("Fecha Transacción"))
    if (!date) { fail("Fecha Transacción", "Fecha inválida"); return }
    const transactionDate = date.toISOString().slice(0, 10)
    if (context && (transactionDate < context.from || transactionDate > context.to)) {
      fail("Fecha Transacción", "La fecha está fuera del período solicitado")
      return
    }

    const rawProduct = text(get("Producto"))
    const productId = fuelProductIdForLegacy(rawProduct)
    const expectedProductId = context?.expectedProduct === "diesel" ? FUEL_PRODUCT_IDS.diesel : context?.expectedProduct === "bluemax" ? FUEL_PRODUCT_IDS.bluemax : null
    if ((productId !== FUEL_PRODUCT_IDS.diesel && productId !== FUEL_PRODUCT_IDS.bluemax) || (expectedProductId && productId !== expectedProductId)) {
      fail("Producto", "Producto ausente, desconocido o distinto al solicitado")
      return
    }

    const liters = parseExactChileanDecimal(get("Volumen"), 4)
    if (liters.status !== "value" || liters.units <= BigInt(0)) {
      fail("Volumen", liters.status === "invalid" ? `Volumen inválido (${liters.reason})` : "El volumen debe ser mayor a cero")
      return
    }
    const rawPrice = get("Precio")
    const unitPrice = parseExactChileanDecimal(rawPrice, 4)
    if (unitPrice.status === "invalid") { fail("Precio", `Precio inválido (${unitPrice.reason})`); return }
    const amount = parseExactChileanDecimal(get("Monto"), 2)
    if (amount.status !== "value" || amount.units < BigInt(0)) {
      fail("Monto", amount.status === "invalid" ? `Monto inválido (${amount.reason})` : amount.status === "empty" ? "Falta el monto" : "El monto debe ser ≥ 0")
      return
    }

    seen.add(documentNumber)
    rows.push({
      rowIndex,
      documentNumber,
      cardNumber,
      assignment: text(get("Asignación")),
      productId,
      sourceDate: transactionDate,
      occurredAt: santiagoInstant(date, asDate(get("Hora Transacción"))),
      liters: Number(liters.normalized),
      unitPrice: unitPrice.status === "value" ? Number(unitPrice.normalized) : null,
      amount: Number(amount.normalized),
      station: text(get("Estación de Servicio")),
      // Odómetro y rendimiento vienen siempre en 0: una vasija no tiene consumo
      // propio. No se leen, para que nadie los tome por métricas más adelante.
      rawRow: withoutPersonalData(record),
    })
  })

  return { rows, errors }
}
