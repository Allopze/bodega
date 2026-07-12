import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { parseFleetXlsx } from "./fleet-xlsx-import"

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("Hoja 1")
  sheet.addRows(rows)
  return Buffer.from(await book.xlsx.writeBuffer())
}

const HEADERS = ["CODIGO", "PATENTE", "FAENA", "TIPO", "MARCA", "MODELO", "AÑO", "HOROMETRO / ODOMETRO", "UNIDAD", "SUMINISTRADOR"]

describe("parseFleetXlsx", () => {
  it("parses the real Consolidado Combustibles vehicle columns", async () => {
    const result = await parseFleetXlsx(await workbook([
      HEADERS,
      ["CA-100", "VPTR-69", "ADMINISTRACIÓN", "CAMIONETA", "MAXUS", "T60 2.0 DIESEL", 2025, 35, "KM", "ARAMCO"],
    ]))

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([{
      rowIndex: 2, plate: "VPTR-69", code: "CA-100", worksiteName: "ADMINISTRACIÓN",
      type: "camioneta", brand: "MAXUS", model: "T60 2.0 DIESEL", year: 2025,
    }])
  })

  it("rejects missing catalogue headers and duplicate plates", async () => {
    const missing = await parseFleetXlsx(await workbook([["PATENTE", "FAENA"]]))
    expect(missing.errors[0]?.message).toMatch(/Faltan columnas/i)

    const duplicate = await parseFleetXlsx(await workbook([
      HEADERS,
      ["CA-1", "AA-11", "PACIFICO", "CAMION", "Marca", "Modelo", 2024],
      ["CA-2", "AA-11", "PACIFICO", "CAMION", "Marca", "Modelo", 2024],
    ]))
    expect(duplicate.rows).toHaveLength(1)
    expect(duplicate.errors[0]).toMatchObject({ rowIndex: 3, field: "PATENTE" })
  })
})
