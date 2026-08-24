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

  it("agrega la patente repetida en una sola fila y la sigue reportando", async () => {
    // Empujarla como segunda fila la hacía entrar al ledger como identidad
    // duplicada —la identidad es (período, producto, patente)—, y ahí no pasaba
    // el filtro de la proyección: sus litros y su monto desaparecían del lote.
    const buffer = await createTestExcel([validRow, { ...validRow, "N° Transacciones": 20 }])
    const result = await parseConsumptionExcel(buffer)
    expect(result.rows).toHaveLength(1)
    expect(result.duplicates).toEqual([3])
    expect(result.rows[0]).toMatchObject({
      patente: "AB-CD12",
      numeroTarjetas: 4,
      numeroTransacciones: 35,
      cantidadUnidad: 2469.12,
      monto: 2300000,
      // Mismo rendimiento en ambas filas: ponderar no lo mueve.
      rendimientoPromedio: 3.5,
    })
    expect(result.rows[0]!.rawRow).toHaveProperty("agregado")
  })

  it("pondera el rendimiento por litros al agregar", async () => {
    const buffer = await createTestExcel([
      { ...validRow, "Cantidad (Unidad)": "100", "Rendimiento Promedio": "2" },
      { ...validRow, "Cantidad (Unidad)": "300", "Rendimiento Promedio": "6" },
    ])
    const result = await parseConsumptionExcel(buffer)
    // (2*100 + 6*300) / 400 = 5, no el promedio simple 4.
    expect(result.rows[0]).toMatchObject({ cantidadUnidad: 400, rendimientoPromedio: 5 })
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

  it("aggregates the Copec detail export by plate", async () => {
    const buffer = await createTestExcel([
      { "Producto": "Diésel", "Tarjeta": "1001", "Patente": "AA-BB11", "Fecha Transacción": "01-01-2026", "Volumen": "10,5", "Monto": "10.000", "Rendimiento (Kms. por Litro)": "4,0" },
      { "Producto": "Diésel", "Tarjeta": "1002", "Patente": "AA-BB11", "Fecha Transacción": "10-01-2026", "Volumen": "20,5", "Monto": "20.000", "Rendimiento (Kms. por Litro)": "6,0" },
      { "Producto": "Diésel", "Tarjeta": "2001", "Patente": "CC-DD22", "Fecha Transacción": "12-01-2026", "Volumen": "8", "Monto": "8.000", "Rendimiento (Kms. por Litro)": "5,0" },
    ])

    const result = await parseConsumptionExcel(buffer)

    expect(result.errors).toEqual([])
    expect(result.duplicates).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      patente: "AA-BB11",
      numeroTarjetas: 2,
      numeroTransacciones: 2,
      cantidadUnidad: 31,
      monto: 30000,
      rendimientoPromedio: 5.32,
    })
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
