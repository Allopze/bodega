import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { parseConsumptionExcel, normalizePlate } from "../consumption-import"

async function createTestExcel(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Consumos")
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

describe("normalizePlate", () => {
  it("trims, uppercases and collapses spaces", () => {
    expect(normalizePlate(" ab-cd12 ")).toBe("AB-CD12")
    expect(normalizePlate("ab cd 12")).toBe("ABCD12")
  })
})

describe("parseConsumptionExcel", () => {
  const validRow = {
    "Patente": "ab-cd12",
    "N° Tarjetas": 2,
    "N° Transacciones": 15,
    "Cantidad (Unidad)": "1.234,56",
    "Monto ($)": "1.150.000",
    "Rendimiento Promedio": "3,5",
  }

  it("parses a valid row correctly, normalizing plate and chilean numbers", async () => {
    const buffer = await createTestExcel([validRow])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0]!.patente).toBe("AB-CD12")
    expect(result.rows[0]!.cantidadUnidad).toBe(1234.56)
    expect(result.rows[0]!.monto).toBe(1150000)
    expect(result.rows[0]!.rendimientoPromedio).toBe(3.5)
  })

  it("rejects a row with an empty patente", async () => {
    const row = { ...validRow, "Patente": "" }
    const buffer = await createTestExcel([row])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.field).toBe("Patente")
  })

  it("rejects negative numeric fields", async () => {
    const row = { ...validRow, "Monto ($)": -100 }
    const buffer = await createTestExcel([row])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.field).toBe("Monto ($)")
  })

  it("detects duplicate plates within the same file", async () => {
    const buffer = await createTestExcel([validRow, { ...validRow, "N° Transacciones": 20 }])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(2)
    expect(result.duplicates).toEqual([3])
  })

  it("tolerates header aliases with accents and symbols", async () => {
    const row = {
      "PATENTE": "XY1234",
      "N Tarjetas": 1,
      "N Transacciones": 3,
      "Cantidad": 100,
      "Monto": 90000,
      "Rendimiento": 4,
    }
    const buffer = await createTestExcel([row])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.patente).toBe("XY1234")
  })

  it("returns a friendly error for a corrupt file", async () => {
    const buffer = new TextEncoder().encode("not an excel file").buffer
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.message).toMatch(/inválido o corrupto/)
  })

  it("skips fully empty rows", async () => {
    const buffer = await createTestExcel([validRow, { "Patente": "", "N° Tarjetas": "", "N° Transacciones": "", "Cantidad (Unidad)": "", "Monto ($)": "", "Rendimiento Promedio": "" }])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })
})
