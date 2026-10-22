import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseFuelOperationsExcel } from "./operations-import"
import { OPERATIONS_TEMPLATE_COLUMNS, buildOperationsTemplateBase64 } from "./operations-import-template"

async function load(base64: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(base64, "base64") as never)
  return workbook
}

describe("plantilla del log operacional", () => {
  it("trae los encabezados exactos del importador y una hoja de instrucciones", async () => {
    const workbook = await load(await buildOperationsTemplateBase64())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Cargas", "Instrucciones"])
    const header = (workbook.getWorksheet("Cargas")!.getRow(1).values as unknown[]).slice(1)
    expect(header).toEqual(OPERATIONS_TEMPLATE_COLUMNS.map((column) => column.header))
    const guide = workbook.getWorksheet("Instrucciones")!
    const text = guide.getSheetValues().flat().join(" ")
    expect(text).toContain("dd-mm-aaaa")
    expect(text).toContain("km/L")
    expect(text).toContain("L/h")
  })

  it("un archivo armado con la plantilla lo lee el importador sin errores de columnas", async () => {
    const workbook = await load(await buildOperationsTemplateBase64())
    const sheet = workbook.getWorksheet("Cargas")!
    const columns = OPERATIONS_TEMPLATE_COLUMNS.map((column) => column.header)
    const row = columns.map((header) => ({ Patente: "ab-12-34", Fecha: "15-01-2026", LT: "85,5", "Horometro / Odometro": "12.345,6" } as Record<string, string>)[header] ?? null)
    sheet.addRow(row)
    const parsed = await parseFuelOperationsExcel(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({ plate: "AB-12-34", fecha: "2026-01-15", liters: 85.5, horometro: 12345.6 })
  })

  it("el importador rechaza fecha de relleno, litros en cero y sello de relleno con su motivo", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Log")
    sheet.addRow(["Patente", "Fecha", "LT", "Sello Instalado"])
    sheet.addRow(["AB1234", "1899-12-30", 10, null])
    sheet.addRow(["AB1234", "2026-02-01", 0, null])
    sheet.addRow(["AB1234", "2026-02-01", 10, "777777"])
    sheet.addRow(["AB1234", "2026-02-01", 10, "0504"])
    const parsed = await parseFuelOperationsExcel(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.errors.map((error) => [error.rowIndex, error.field])).toEqual([[2, "Fecha"], [3, "LT"], [4, "Sello Instalado"]])
    expect(parsed.errors[0]!.rawRow).toMatchObject({ Patente: "AB1234" })
  })
})
