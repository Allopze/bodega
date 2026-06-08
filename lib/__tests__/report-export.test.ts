import ExcelJS from "exceljs"
import { describe, expect, it, vi } from "vitest"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

const report: ReportData = {
  filenameBase: "reporte-test",
  worksheetName: "Reporte test",
  headers: ["OC", "Proveedor", "Monto"],
  rows: [
    ["OC-1", "Proveedor, con coma", 1000],
    ["OC-2", "Proveedor \"quoted\"", null],
  ],
}

describe("report export helpers", () => {

  it("builds a parseable XLSX workbook with headers and rows", async () => {
    const buffer = await buildXlsxBuffer(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)

    const worksheet = workbook.getWorksheet("Reporte test")
    expect(worksheet).toBeDefined()
    expect(worksheet?.getRow(1).values).toEqual([undefined, "OC", "Proveedor", "Monto"])
    expect(worksheet?.getCell("B2").value).toBe("Proveedor, con coma")
    expect(worksheet?.getCell("C2").value).toBe(1000)
    expect(worksheet?.getCell("C3").value).toBe("")
  })
})
