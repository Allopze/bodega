import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseTaeReceiptExcel } from "./tae-receipt-import"
import { FUEL_PRODUCT_IDS } from "./fuel-products"

const HEADERS = [
  "Producto", "Tarjeta", "Tipo de Tarjeta", "Asignación", "N° Vehículo", "Tipo de Vehículo",
  "Departamento", "Rut Chofer", "Región", "Comuna", "Estación de Servicio",
  "Fecha Transacción", "Hora Transacción", "Guía de Despacho", "Rut Atendedor",
  "Precio", "Volumen", "Monto", "Odómetro (Kms.)", "Rendimiento (Kms. por Litro)", "Rendimiento ($ por Km.)",
]

/** Copec entrega la fecha a medianoche UTC y la hora como serial Excel (época 1899). */
function row(over: Partial<{ product: string; cardType: string; guia: number; volumen: number; hora: Date }> = {}) {
  return [
    over.product ?? "Diésel",
    "1-242269-00230-9-1",
    over.cardType ?? "TAE",
    "CHOLGUAN", 5, "CAMION", "DEPARTAMENTO TAE", "0-0", "BIOBIO", "LOS ANGELES", "2946-ERCILLA N° 799",
    new Date("2026-06-29T00:00:00.000Z"),
    over.hora ?? new Date("1899-12-30T08:44:47.000Z"),
    over.guia ?? 45769934,
    "0-0",
    1318, over.volumen ?? 1241, 1635638, 0, 0, 0,
  ]
}

async function fixture(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Consumos")
  sheet.addRow(HEADERS)
  for (const values of rows) sheet.addRow(values)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("parseTaeReceiptExcel", () => {
  it("mapea una recepción TAE con guía, litros y producto", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row()]))

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      documentNumber: "45769934",
      cardNumber: "1-242269-00230-9-1",
      assignment: "CHOLGUAN",
      productId: FUEL_PRODUCT_IDS.diesel,
      liters: 1241,
      station: "2946-ERCILLA N° 799",
    })
  })

  it("interpreta la hora como hora chilena, no como UTC", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row()]))

    // 08:44:47 en Chile (junio, UTC-4) es 12:44:47 UTC. Leerla como UTC correría
    // la carga 4 horas y movería de día/mes las cargas de fin de mes por la noche.
    expect(result.rows[0]!.occurredAt).toBe("2026-06-29T12:44:47.000Z")
  })

  it("reconoce BlueMax como producto propio", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row({ product: "BlueMax" })]))

    expect(result.rows[0]!.productId).toBe(FUEL_PRODUCT_IDS.bluemax)
  })

  it("descarta filas que no son TAE en vez de tratarlas como recepción", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row({ cardType: "TCT" })]))

    expect(result.rows).toEqual([])
    expect(result.errors[0]).toMatchObject({ field: "Tipo de Tarjeta" })
  })

  it("descarta guías repetidas dentro del archivo", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row(), row()]))

    expect(result.rows).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ field: "Guía de Despacho" })
  })

  it("descarta volumen cero: una recepción sin litros no es una recepción", async () => {
    const result = await parseTaeReceiptExcel(await fixture([row({ volumen: 0 })]))

    expect(result.rows).toEqual([])
    expect(result.errors[0]).toMatchObject({ field: "Volumen" })
  })
})
