import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { parseFuelOperationsExcel, normalizePlate, plateMatchKey } from "../operations-import"

async function createTestExcel(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Hoja 1")
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

describe("normalizePlate / plateMatchKey", () => {
  it("normalizePlate trims, uppercases and collapses spaces but keeps hyphens", () => {
    expect(normalizePlate(" bpdh-41 ")).toBe("BPDH-41")
  })

  it("plateMatchKey strips separators for cross-format matching", () => {
    expect(plateMatchKey("BP-DH-67")).toBe("BPDH67")
    expect(plateMatchKey("BPDH67")).toBe("BPDH67")
  })
})

describe("parseFuelOperationsExcel", () => {
  const validRow = {
    "CODIGO": "CA-82",
    "PATENTE": "klkr-98",
    "FECHA": new Date(Date.UTC(2025, 9, 1)),
    "HORA CARGA": new Date(Date.UTC(1899, 11, 30, 16, 55, 54)),
    "FAENA": "ADMINISTRACIÓN",
    "TIPO EQUIPO": "CAMIONETA",
    "MARCA": "TOYOTA",
    "MODELO": "HYLUX DCAB 2.4",
    "AÑO": 2020,
    "HOROMETRO / ODOMETRO": 32000,
    "MEDIDO POR HORA O KM": "KM",
    "LT": 32.9194,
    "OPERADOR CONDUCTOR": "L.CORDOBA",
    "SUPERVISOR TURNO": "P.PANES",
    "SUMINISTRO ENTREGADO POR:": "ARAMCO",
    "RENDIMIENTO": 11.34,
    "TIPO DE RENDIMIENTO": "KM/LT",
    "$/lt": "$ 981,00",
    "Monto ($)": 32294,
  }

  it("parses a valid row correctly", async () => {
    const buffer = await createTestExcel([validRow])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]!
    expect(row.plate).toBe("KLKR-98")
    expect(row.code).toBe("CA-82")
    expect(row.fecha).toBe("2025-10-01")
    expect(row.horaCarga).toBe("16:55")
    expect(row.tipo).toBe("camioneta")
    expect(row.medidoPor).toBe("km")
    expect(row.liters).toBeCloseTo(32.9194)
    expect(row.monto).toBe(32294)
    expect(row.rendimiento).toBeCloseTo(11.34)
    expect(row.tipoRendimiento).toBe("km_lt")
    expect(row.proveedorNombre).toBe("ARAMCO")
  })

  it("rejects a row with an empty patente", async () => {
    const row = { ...validRow, "PATENTE": "" }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.field).toBe("Patente")
  })

  it("lee la fecha chilena de texto como DD/MM y no como MM/DD", async () => {
    const buffer = await createTestExcel([{ ...validRow, "FECHA": "03/02/2026" }])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0]!.fecha).toBe("2026-02-03")
  })

  it("rejects a row with a missing fecha", async () => {
    const row = { ...validRow, "FECHA": null }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.field).toBe("Fecha")
  })

  it("rejects negative liters", async () => {
    const row = { ...validRow, "LT": -5 }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.field).toBe("LT")
  })

  it("coerces dirty AÑO/MEDIDO POR (0, #N/D) to null", async () => {
    const row = { ...validRow, "AÑO": 0, "MEDIDO POR HORA O KM": 0, "TIPO EQUIPO": "#N/D" }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.anio).toBeNull()
    expect(result.rows[0]!.medidoPor).toBeNull()
    expect(result.rows[0]!.tipo).toBeNull()
  })

  it('treats "-" rendimiento as null, not zero', async () => {
    const row = { ...validRow, "RENDIMIENTO": "-" }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows[0]!.rendimiento).toBeNull()
  })

  it("tolerates header aliases", async () => {
    const row = {
      "Codigo": "KA-63",
      "Patente": "YT2530",
      "Fecha": new Date(Date.UTC(2025, 9, 5)),
      "Faena": "MASISA MADERAS",
      "Tipo": "CAMION",
      "Horometro": 571,
      "Medido Por": "KM",
      "Litros": 30,
      "Operador": "R.VALDEBENITO",
      "Proveedor": "TCT",
    }
    const buffer = await createTestExcel([row])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.plate).toBe("YT2530")
    expect(result.rows[0]!.tipo).toBe("camion")
  })

  it("returns a friendly error for a corrupt file", async () => {
    const buffer = new TextEncoder().encode("not an excel file").buffer
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]!.message).toMatch(/inválido o corrupto/)
  })

  it("skips fully empty rows", async () => {
    const emptyRow = Object.fromEntries(Object.keys(validRow).map((k) => [k, null]))
    const buffer = await createTestExcel([validRow, emptyRow])
    const result = await parseFuelOperationsExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })
})
