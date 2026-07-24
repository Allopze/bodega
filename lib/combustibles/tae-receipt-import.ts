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
import { normKey, sheetToRecords, parseChileanNumber } from "./xlsx-utils"
import { fuelProductIdForLegacy } from "./fuel-products"

export interface ParsedTaeReceiptRow {
  rowIndex: number
  /** Guía de despacho: única por transacción. Es la clave de idempotencia. */
  documentNumber: string
  cardNumber: string
  assignment: string
  productId: string
  occurredAt: string
  liters: number
  unitPrice: number
  amount: number
  station: string
  rawRow: Record<string, unknown>
}

export interface TaeReceiptImportError {
  rowIndex: number
  field: string
  message: string
}

export interface TaeReceiptImportResult {
  rows: ParsedTaeReceiptRow[]
  errors: TaeReceiptImportError[]
}

const TZ = "America/Santiago"

/** Desfase real de la zona en un instante UTC dado (Chile alterna -03/-04). */
const ZONE_PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

function zoneOffsetMs(instant: Date): number {
  const parts = ZONE_PARTS_FORMAT.formatToParts(instant)
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"))
  return asUtc - instant.getTime()
}

/**
 * Copec entrega hora de pared chilena en dos celdas (fecha y hora por separado, la
 * hora como serial de Excel con época 1899). Interpretarla como UTC correría cada
 * carga 3–4 horas y movería de mes las de fin de mes por la noche, que es
 * justamente lo que la conciliación mensual tiene que cuadrar.
 */
function santiagoInstant(date: Date, time: Date | null): string {
  const wall = Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    time?.getUTCHours() ?? 0, time?.getUTCMinutes() ?? 0, time?.getUTCSeconds() ?? 0,
  )
  // Dos pasadas: la primera estima el desfase, la segunda lo corrige si la
  // estimación cayó al otro lado de un cambio de horario.
  let utc = wall - zoneOffsetMs(new Date(wall))
  utc = wall - zoneOffsetMs(new Date(utc))
  return new Date(utc).toISOString()
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  return null
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

export async function parseTaeReceiptExcel(buffer: Buffer): Promise<TaeReceiptImportResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "archivo", message: "El archivo no tiene hojas" }] }

  const rows: ParsedTaeReceiptRow[] = []
  const errors: TaeReceiptImportError[] = []
  const seen = new Set<string>()

  sheetToRecords(sheet).forEach((record, index) => {
    const rowIndex = index + 2 // fila 1 = encabezados
    const get = reader(record)
    const fail = (field: string, message: string) => errors.push({ rowIndex, field, message })

    // El canal se elige en el portal, pero el archivo lo declara por fila. Si una
    // fila no es TAE, el informe descargado no es el que creemos: no la adivinamos.
    const cardType = text(get("Tipo de Tarjeta"))
    if (cardType.toUpperCase() !== "TAE") {
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

    const liters = parseChileanNumber(get("Volumen"))
    if (!(liters > 0)) { fail("Volumen", "El volumen debe ser mayor a cero"); return }

    seen.add(documentNumber)
    rows.push({
      rowIndex,
      documentNumber,
      cardNumber,
      assignment: text(get("Asignación")),
      productId: fuelProductIdForLegacy(text(get("Producto"))),
      occurredAt: santiagoInstant(date, asDate(get("Hora Transacción"))),
      liters,
      unitPrice: parseChileanNumber(get("Precio")),
      amount: parseChileanNumber(get("Monto")),
      station: text(get("Estación de Servicio")),
      // Odómetro y rendimiento vienen siempre en 0: una vasija no tiene consumo
      // propio. No se leen, para que nadie los tome por métricas más adelante.
      rawRow: record,
    })
  })

  return { rows, errors }
}
