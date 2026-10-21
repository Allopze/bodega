/**
 * Parser de archivos Excel para importación de consumos de combustible por
 * patente y periodo (reportes de tarjetas de combustible — Copec, Enex, etc.).
 * A diferencia de `import.ts` (facturas individuales con fecha por fila), esta
 * planilla resume consumos por patente para un periodo declarado por el usuario
 * al momento de subir el archivo.
 */

import ExcelJS from "exceljs"
import { normKey, sheetToRecords, parseChileanNumber, parseExactChileanDecimal, parseSheetDate, normalizePlate, isCopecCardOfChannel } from "./xlsx-utils"
import { copecDetailReading, withoutPersonalData, type ParsedMeterReading } from "./meter-readings"
import { summarizeMeterPerformance } from "./meter-performance"
import { fuelProductIdForLegacy } from "./fuel-products"

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
  rawRow?: Record<string, unknown>
}

export interface ConsumptionImportResult {
  rows: ParsedConsumptionRow[]
  errors: ImportError[]
  duplicates: number[]   // rowIndex de patentes repetidas dentro del archivo
  /** Lecturas de medidor por transacción. Sólo el informe de detalle las trae;
   *  el resumen por patente no tiene una fila por carga que leer. */
  detail: ParsedMeterReading[]
  /** Individual rows from the detail report, retained in shadow alongside the monthly projection. */
  transactions: ParsedCopecTransaction[]
}

export interface ParsedCopecTransaction {
  rowIndex: number
  sourceRef: string | null
  sourceDate: string
  occurredAt: string
  plate: string
  cardNumber: string | null
  product: "diesel" | "bluemax"
  liters: number
  unitPrice: number | null
  amount: number
  station: string | null
  rawPayload: Record<string, unknown>
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

export interface CopecParseContext {
  expectedProduct?: "diesel" | "bluemax"
  period?: { from: string; to: string }
}

function parseCopecDetail(records: Record<string, unknown>[], context?: CopecParseContext): ConsumptionImportResult {
  const errors: ImportError[] = []
  const detail: ParsedMeterReading[] = []
  const transactions: ParsedCopecTransaction[] = []
  const groups = new Map<string, {
    rowIndex: number
    cards: Set<string>
    transactions: Record<string, unknown>[]
    quantityUnits: bigint
    amountUnits: bigint
    readings: ParsedMeterReading[]
  }>()

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    const rowIndex = typeof record.__row === "number" ? record.__row : index + 2
    const get = normalizedRecord(record)
    const patente = normalizePlate(String(get("Patente") ?? ""))
    if (!patente) {
      errors.push({ rowIndex, field: "Patente", message: "La patente es requerida", rawRow: withoutPersonalData(record) })
      continue
    }

    const transactionDate = parseSheetDate(get("Fecha Transacción", "Fecha"))
    if (!transactionDate) {
      errors.push({ rowIndex, field: "Fecha Transacción", message: "Fecha inválida", rawRow: withoutPersonalData(record) })
      continue
    }
    if (context?.period && (transactionDate < context.period.from || transactionDate > context.period.to)) {
      errors.push({ rowIndex, field: "Fecha Transacción", message: "La fecha está fuera del período solicitado", rawRow: withoutPersonalData(record) })
      continue
    }

    const cardType = get("Tipo de Tarjeta", "Tipo Tarjeta")
    if (cardType !== null && cardType !== undefined && String(cardType).trim() && !isCopecCardOfChannel(cardType, "TCT")) {
      errors.push({ rowIndex, field: "Tipo de Tarjeta", message: "Se esperaba una fila TCT", rawRow: withoutPersonalData(record) })
      continue
    }

    const rawProduct = get("Producto", "Combustible")
    if (rawProduct !== null && rawProduct !== undefined && String(rawProduct).trim()) {
      const productId = fuelProductIdForLegacy(String(rawProduct))
      const expectedProductId = context?.expectedProduct === "diesel" ? "fuel-diesel" : context?.expectedProduct === "bluemax" ? "fuel-bluemax" : null
      if ((productId !== "fuel-diesel" && productId !== "fuel-bluemax") || (expectedProductId && productId !== expectedProductId)) {
        errors.push({ rowIndex, field: "Producto", message: "El producto no coincide con el informe solicitado", rawRow: withoutPersonalData(record) })
        continue
      }
    }

    const quantity = parseExactChileanDecimal(get("Volumen", "Cantidad (Unidad)", "Cantidad", "Litros"), 4)
    if (quantity.status !== "value" || quantity.units <= BigInt(0)) {
      errors.push({ rowIndex, field: "Volumen", message: quantity.status === "invalid" ? `Volumen inválido (${quantity.reason})` : "El volumen debe ser mayor a cero", rawRow: withoutPersonalData(record) })
      continue
    }
    const amount = parseExactChileanDecimal(get("Monto ($)", "Monto"), 2)
    if (amount.status !== "value" || amount.units < BigInt(0)) {
      errors.push({ rowIndex, field: "Monto ($)", message: amount.status === "invalid" ? `Monto inválido (${amount.reason})` : amount.status === "empty" ? "Falta el monto" : "El monto debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }
    const performance = parseChileanNumber(get("Rendimiento (Kms. por Litro)", "Rendimiento Promedio", "Rendimiento"))
    if (performance < 0) {
      errors.push({ rowIndex, field: "Rendimiento", message: "Debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }

    const reportedUnitPrice = parseExactChileanDecimal(get("Precio Unitario", "Precio por Litro", "Precio"), 4)
    if (reportedUnitPrice.status === "invalid") {
      errors.push({ rowIndex, field: "Precio", message: `Precio inválido (${reportedUnitPrice.reason})`, rawRow: withoutPersonalData(record) })
      continue
    }
    const rawProductValue = get("Producto", "Combustible")
    const rawProductId = rawProductValue === null || rawProductValue === undefined || !String(rawProductValue).trim()
      ? context?.expectedProduct === "diesel" ? "fuel-diesel" : context?.expectedProduct === "bluemax" ? "fuel-bluemax" : null
      : fuelProductIdForLegacy(String(rawProductValue))
    const product = rawProductId === "fuel-diesel" ? "diesel" : rawProductId === "fuel-bluemax" ? "bluemax" : null
    if (!product) {
      errors.push({ rowIndex, field: "Producto", message: "Producto ausente o desconocido", rawRow: withoutPersonalData(record) })
      continue
    }
    const cleanRecord = withoutPersonalData(record)
    const reading = copecDetailReading(record)
    transactions.push({
      rowIndex,
      sourceRef: String(get("Guía de Despacho", "Guia de Despacho") ?? "").trim() || null,
      sourceDate: transactionDate,
      occurredAt: reading?.occurredAt ?? transactionDate,
      plate: patente,
      cardNumber: String(get("Tarjeta", "N° Tarjeta", "Numero Tarjeta") ?? "").trim() || null,
      product,
      liters: Number(quantity.normalized),
      unitPrice: reportedUnitPrice.status === "value" ? Number(reportedUnitPrice.normalized) : null,
      amount: Number(amount.normalized),
      station: String(get("Estación de Servicio", "Estacion de Servicio") ?? "").trim() || null,
      rawPayload: cleanRecord,
    })

    const group = groups.get(patente) ?? {
      rowIndex,
      cards: new Set<string>(),
      transactions: [],
      quantityUnits: BigInt(0),
      amountUnits: BigInt(0),
      readings: [],
    }
    const card = String(get("Tarjeta", "N° Tarjeta", "Numero Tarjeta") ?? "").trim()
    if (card) group.cards.add(card)
    // Sanitizado ANTES de acumular: `group.transactions` termina en
    // `rawRow.detalle`, que es lo que se guarda en la fila de consumo.
    group.transactions.push(cleanRecord)
    group.quantityUnits += quantity.units
    group.amountUnits += amount.units
    if (reading) {
      group.readings.push(reading)
      detail.push(reading)
    }
    groups.set(patente, group)
  }

  // El rendimiento sale de la serie de odómetro y NO del promedio ponderado de
  // la columna del proveedor: Copec entrega 0 cuando la lectura de la boleta
  // retrocede —el operario perdió un dígito al tipear— y ese 0 se comía la carga
  // entera del promedio del mes. La serie puentea el tramo malo y sólo cae al
  // dato del proveedor donde no hay tramo propio que calcular.
  const rows = [...groups.entries()].map(([patente, group]): ParsedConsumptionRow => ({
    rowIndex: group.rowIndex,
    patente,
    numeroTarjetas: group.cards.size,
    numeroTransacciones: group.transactions.length,
    cantidadUnidad: Number(group.quantityUnits) / 10_000,
    monto: Number(group.amountUnits) / 100,
    rendimientoPromedio: summarizeMeterPerformance(group.readings.map((reading) => ({
      occurredAt: reading.occurredAt,
      value: reading.value,
      liters: reading.liters ?? 0,
      providerPerformance: reading.providerPerformance,
    }))).average,
    rawRow: { detalle: group.transactions },
  }))

  return { rows, errors, duplicates: [], detail, transactions }
}

/**
 * Parsea un archivo Excel de consumos por patente. Server-side siempre
 * (nunca se confía en filas parseadas por el cliente) — a diferencia de
 * `parseFuelExcel`, que también corre en el navegador, este parser solo se
 * invoca desde server actions, así que puede aceptar un Buffer de Node.
 */
export async function parseConsumptionExcel(fileBuffer: ArrayBuffer | Buffer, context?: CopecParseContext): Promise<ConsumptionImportResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo Excel inválido o corrupto" }], duplicates: [], detail: [], transactions: [] }
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró hoja con datos" }], duplicates: [], detail: [], transactions: [] }

  const records = sheetToRecords(sheet)

  // "Descargar Detalle" trae una fila por transacción. El modelo interno guarda
  // un consolidado por patente y mes, por eso agregamos tarjetas, transacciones,
  // litros, monto y rendimiento antes de importar.
  if (isCopecDetail(records)) return parseCopecDetail(records, context)

  const rows: ParsedConsumptionRow[] = []
  const errors: ImportError[] = []
  const duplicates: number[] = []
  // La patente repetida se AGREGA a su fila, no se empuja como una segunda.
  // La identidad de la transacción en el ledger es (período, producto, patente),
  // así que una segunda fila con la misma patente entra como duplicada, no pasa
  // el filtro de la proyección y desaparece del lote: menos litros y menos monto
  // que el archivo, sin que nadie lo vea. Es el mismo criterio que ya aplica
  // `parseCopecDetail` al informe de detalle.
  const byPlate = new Map<string, ParsedConsumptionRow>()
  const sourceRecords = new Map<string, Record<string, unknown>[]>()
  const exactTotals = new Map<string, { quantityUnits: bigint; amountUnits: bigint }>()

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const rowNum = i + 2  // fila 1 = header
    const rowIndex = typeof record.__row === "number" ? record.__row : rowNum

    const get = normalizedRecord(record)

    // Saltar filas completamente vacías
    if (!get("Patente") && !get("Monto ($)", "Monto")) continue

    const patenteRaw = String(get("Patente") ?? "").trim()
    if (!patenteRaw) {
      errors.push({ rowIndex: rowNum, field: "Patente", message: "La patente es requerida", rawRow: withoutPersonalData(record) })
      continue
    }
    const patente = normalizePlate(patenteRaw)

    const cardType = get("Tipo de Tarjeta", "Tipo Tarjeta")
    if (cardType !== null && cardType !== undefined && String(cardType).trim() && !isCopecCardOfChannel(cardType, "TCT")) {
      errors.push({ rowIndex: typeof record.__row === "number" ? record.__row : rowNum, field: "Tipo de Tarjeta", message: "Se esperaba una fila TCT", rawRow: withoutPersonalData(record) })
      continue
    }
    const rawProduct = get("Producto", "Combustible")
    if (rawProduct !== null && rawProduct !== undefined && String(rawProduct).trim()) {
      const productId = fuelProductIdForLegacy(String(rawProduct))
      const expectedProductId = context?.expectedProduct === "diesel" ? "fuel-diesel" : context?.expectedProduct === "bluemax" ? "fuel-bluemax" : null
      if ((productId !== "fuel-diesel" && productId !== "fuel-bluemax") || (expectedProductId && productId !== expectedProductId)) {
        errors.push({ rowIndex, field: "Producto", message: "El producto no coincide con el informe solicitado", rawRow: withoutPersonalData(record) })
        continue
      }
    }
    const rowDate = get("Fecha Transacción", "Fecha")
    if (rowDate !== null && rowDate !== undefined && rowDate !== "") {
      const date = parseSheetDate(rowDate)
      if (!date || (context?.period && (date < context.period.from || date > context.period.to))) {
        errors.push({ rowIndex, field: "Fecha Transacción", message: "Fecha inválida o fuera del período solicitado", rawRow: withoutPersonalData(record) })
        continue
      }
    }

    const numeroTarjetas = parseChileanNumber(get("N° Tarjetas", "N Tarjetas", "Numero Tarjetas", "Tarjetas"))
    if (numeroTarjetas < 0) {
      errors.push({ rowIndex: rowNum, field: "N° Tarjetas", message: "Debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }

    const numeroTransacciones = parseChileanNumber(get("N° Transacciones", "N Transacciones", "Numero Transacciones", "Transacciones"))
    if (numeroTransacciones < 0) {
      errors.push({ rowIndex: rowNum, field: "N° Transacciones", message: "Debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }

    const exactQuantity = parseExactChileanDecimal(get("Cantidad (Unidad)", "Cantidad Unidad", "Cantidad", "Litros"), 4)
    if (exactQuantity.status !== "value" || exactQuantity.units <= BigInt(0)) {
      errors.push({ rowIndex, field: "Cantidad (Unidad)", message: exactQuantity.status === "invalid" ? `Cantidad inválida (${exactQuantity.reason})` : "La cantidad debe ser mayor a cero", rawRow: withoutPersonalData(record) })
      continue
    }
    const cantidadUnidad = Number(exactQuantity.normalized)

    const exactAmount = parseExactChileanDecimal(get("Monto ($)", "Monto"), 2)
    if (exactAmount.status !== "value" || exactAmount.units < BigInt(0)) {
      errors.push({ rowIndex, field: "Monto ($)", message: exactAmount.status === "invalid" ? `Monto inválido (${exactAmount.reason})` : exactAmount.status === "empty" ? "Falta el monto" : "El monto debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }
    const monto = Number(exactAmount.normalized)

    const rendimientoPromedio = parseChileanNumber(get("Rendimiento Promedio", "Rendimiento"))
    if (rendimientoPromedio < 0) {
      errors.push({ rowIndex: rowNum, field: "Rendimiento Promedio", message: "Debe ser ≥ 0", rawRow: withoutPersonalData(record) })
      continue
    }

    sourceRecords.set(patente, [...(sourceRecords.get(patente) ?? []), withoutPersonalData(record)])
    const previous = byPlate.get(patente)
    if (previous) {
      duplicates.push(rowNum)
      // El rendimiento se pondera por litros, como en `parseCopecDetail`:
      // promediar dos rendimientos a secas ignora que uno cargó el triple.
      const cantidadTotal = previous.cantidadUnidad + cantidadUnidad
      previous.rendimientoPromedio = cantidadTotal > 0
        ? Math.round(((previous.rendimientoPromedio * previous.cantidadUnidad + rendimientoPromedio * cantidadUnidad) / cantidadTotal) * 100) / 100
        : 0
      previous.numeroTarjetas += numeroTarjetas
      previous.numeroTransacciones += numeroTransacciones
      const totals = exactTotals.get(patente)!
      totals.quantityUnits += exactQuantity.units
      totals.amountUnits += exactAmount.units
      previous.cantidadUnidad = Number(totals.quantityUnits) / 10_000
      previous.monto = Number(totals.amountUnits) / 100
      continue
    }

    const row: ParsedConsumptionRow = {
      rowIndex: rowNum,
      patente,
      numeroTarjetas,
      numeroTransacciones,
      cantidadUnidad,
      monto,
      rendimientoPromedio,
      rawRow: withoutPersonalData(record),
    }
    exactTotals.set(patente, { quantityUnits: exactQuantity.units, amountUnits: exactAmount.units })
    byPlate.set(patente, row)
    rows.push(row)
  }

  // Sólo las patentes que se agregaron cambian de forma: el caso normal —una
  // fila por patente— conserva su registro crudo tal cual.
  for (const row of rows) {
    const records = sourceRecords.get(row.patente) ?? []
    if (records.length > 1) row.rawRow = { agregado: records }
  }

  // El resumen por patente no trae una fila por carga: sin transacciones no hay
  // lectura de medidor que rescatar.
  return { rows, errors, duplicates, detail: [], transactions: [] }
}
