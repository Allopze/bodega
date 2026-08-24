import { describe, it, expect } from "vitest"
import { parseFuelExcel } from "../import"
import ExcelJS from "exceljs"

async function createTestExcel(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("BASE DE DATOS")
  const headers: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key)
    }
  }
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null))
  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as unknown as ArrayBuffer
}

describe("parseFuelExcel", () => {
  const validRow = {
    "MES-AÑO": new Date("2026-01-15"),
    "SERVICIO": "TCT",
    "VEHICULO": "CAMION",
    "PROVEEDOR": "COPEC",
    "CLIENTE": "CHOME",
    "FAENA": "FAENA BIODIVERSA",
    "PRODUCTO": "PETROLEO DIESEL",
    "FACTURA": "29533428",
    "LITROS": 9956.51,
    " IEC Fijo": 1041715,
    " IEC Variable": 817517,
    "Base Afecta": 5961897.01,
    "IMPUESTO IEC\n(FIJO + VARIIABLE)": 1859232,
    "IVA (19%)": 1132760.43,
    "TOTAL FACTURA A PAGAR": 8953889.44,
  }

  it("parses a valid row correctly", async () => {
    const buffer = await createTestExcel([validRow])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.loads[0]!.serviceType).toBe("TCT")
    expect(result.loads[0]!.vehicle).toBe("CAMION")
    expect(result.loads[0]!.liters).toBe(9956.51)
    expect(result.loads[0]!.totalAmount).toBe(8953889.44)
  })

  it("parses optional odometer and hour meter readings", async () => {
    const row = { ...validRow, "KILOMETRAJE": 12500, "HOROMETRO": 440.5 }
    const buffer = await createTestExcel([row])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.loads[0]!.odometerReading).toBe(12500)
    expect(result.loads[0]!.hourMeterReading).toBe(440.5)
  })

  it("detects missing required fields", async () => {
    const invalidRow = { ...validRow, "VEHICULO": "" }
    const buffer = await createTestExcel([invalidRow])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.field).toBe("VEHICULO")
  })

  it("detects invalid service type", async () => {
    const invalidRow = { ...validRow, "SERVICIO": "INVALID" }
    const buffer = await createTestExcel([invalidRow])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.field).toBe("SERVICIO")
  })

  it("detects duplicate receipt numbers", async () => {
    const buffer = await createTestExcel([validRow, { ...validRow }])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(2)
    expect(result.duplicates).toHaveLength(1)
  })

  it("counts a receipt with several detail lines as ONE duplicate, not one per extra line", async () => {
    const buffer = await createTestExcel([validRow, { ...validRow }, { ...validRow }, { ...validRow }])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(4)
    expect(result.duplicates).toHaveLength(1)
  })

  it("skips empty rows", async () => {
    const buffer = await createTestExcel([{}, {}, validRow])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })

  it("handles string dates", async () => {
    const row = { ...validRow, "MES-AÑO": "2026-03-15" }
    const buffer = await createTestExcel([row])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.loads[0]!.month).toBe("2026-03")
  })

  it("lee la fecha chilena de texto como DD/MM y no como MM/DD", async () => {
    // "03/02/2026" es el 3 de febrero. `new Date(texto)` lo leía como 2 de marzo
    // y la carga quedaba contabilizada en otro mes sin dejar rastro.
    const buffer = await createTestExcel([{ ...validRow, "MES-AÑO": "03/02/2026" }])
    const result = await parseFuelExcel(buffer)
    expect(result.errors).toHaveLength(0)
    expect(result.loads[0]!.loadDate).toBe("2026-02-03")
    expect(result.loads[0]!.month).toBe("2026-02")
  })

  it("does not shift dates on servers with UTC offset (H11)", async () => {
    // A Date at midnight local time: toISOString would give previous day in UTC-X zones.
    // We create the date directly as a JS Date object (as Excel does with cellDates:true)
    // and verify the parsed loadDate matches the original calendar date.
    const dateWithMidnight = new Date(2026, 0, 15, 0, 0, 0, 0) // Jan 15 at local midnight
    const buffer = await createTestExcel([{ ...validRow, "MES-AÑO": dateWithMidnight }])
    const result = await parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    // Should always be 2026-01-15 regardless of server timezone offset
    expect(result.loads[0]!.loadDate).toBe("2026-01-15")
    expect(result.loads[0]!.month).toBe("2026-01")
  })

  it("no corre de mes el serial de fecha pura de la columna MES-AÑO", async () => {
    // "MES-AÑO" trae el primero de cada mes como serial entero (numFmt "mmmm-yy").
    // ExcelJS lo decodifica como medianoche UTC; leerlo con getters locales lo
    // dejaba en el día/mes anterior para cualquier navegador chileno (UTC-3/-4).
    const buffer = await createTestExcel([{ ...validRow, "MES-AÑO": new Date(Date.UTC(2026, 0, 1)) }])
    const result = await parseFuelExcel(buffer)
    expect(result.errors).toHaveLength(0)
    expect(result.loads[0]!.loadDate).toBe("2026-01-01")
    expect(result.loads[0]!.month).toBe("2026-01")
  })

  it("returns empty for empty file", async () => {
    const result = await parseFuelExcel(new ArrayBuffer(0))
    expect(result.loads).toHaveLength(0)
  })
})
