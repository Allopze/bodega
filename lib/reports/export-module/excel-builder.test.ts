import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { buildXlsxBuffer } from "./excel-builder"
import type { ReportData } from "./types"

/**
 * `buildXlsxBuffer` es el generador Excel compartido por todos los reportes
 * de la app (recepción, compras, PDTP export/reporte de gestión/expediente
 * auditor…). Estas pruebas verifican que el archivo generado se pueda
 * volver a abrir sin errores — la mejor aproximación automatizable a "Excel
 * abre el Excel sin reparaciones" — y que texto de usuario que parece una
 * fórmula (`=SUM(...)`) se guarde como texto literal, nunca como celda de
 * fórmula evaluable.
 */
describe("buildXlsxBuffer", () => {
  it("produces a workbook that reopens cleanly with the same sheet, headers and rows", async () => {
    const report: ReportData = {
      filenameBase: "reporte-prueba",
      worksheetName: "Datos",
      headers: ["Código", "Descripción", "Cantidad"],
      rows: [
        ["A-001", "Primera fila", 10],
        ["A-002", "Segunda fila", null],
        ["A-003", "Tercera fila", undefined],
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    const sheet = reopened.getWorksheet("Datos")
    expect(sheet).toBeDefined()
    expect(sheet!.getRow(1).values).toEqual([undefined, "Código", "Descripción", "Cantidad"])
    expect(sheet!.getRow(2).values).toEqual([undefined, "A-001", "Primera fila", 10])
    // null/undefined se guardan como celda de texto vacía, no como el texto literal "null"/"undefined".
    expect(sheet!.getCell("C3").value).toBe("")
    expect(sheet!.getCell("C4").value).toBe("")
  })

  it("round-trips multiple sheets with their own headers", async () => {
    const report: ReportData = {
      filenameBase: "reporte-multi",
      worksheetName: "Resumen",
      headers: ["A"],
      rows: [["ignorado, se usan sheets"]],
      sheets: [
        { worksheetName: "Resumen", headers: ["Objetivo", "Avance"], rows: [["Objetivo 1", 0.8]] },
        { worksheetName: "Detalle", headers: ["Actividad"], rows: [["Actividad 1"], ["Actividad 2"]] },
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    expect(reopened.worksheets.map((ws) => ws.name)).toEqual(["Resumen", "Detalle"])
    expect(reopened.getWorksheet("Detalle")!.rowCount).toBe(3) // header + 2 filas
  })

  it("stores user text that looks like a formula as a literal string, never as an evaluable formula cell", async () => {
    const maliciousLookingText = "=SUM(A1:A10)"
    const report: ReportData = {
      filenameBase: "reporte-seguro",
      worksheetName: "Datos",
      headers: ["Actividad"],
      rows: [[maliciousLookingText], ["+2+5"], ["-2+5"], ["@SUM(1,2)"]],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet("Datos")!

    for (const rowNumber of [2, 3, 4, 5]) {
      const cell = sheet.getCell(`A${rowNumber}`)
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)
      expect(cell.formula).toBeUndefined()
    }
    // El valor se guarda con un apóstrofe inicial: es el texto literal que ExcelJS/Excel
    // interpretan como "fuerza texto", nunca la fórmula evaluable original sin marcar.
    expect(sheet.getCell("A2").value).toBe(`'${maliciousLookingText}`)
  })

  it("passes numeric cells through unchanged, never coerced to string", async () => {
    const report: ReportData = {
      filenameBase: "reporte-numerico",
      worksheetName: "Datos",
      headers: ["Cantidad"],
      rows: [[10]],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet("Datos")!

    const value = sheet.getRow(2).values as unknown[]
    expect(value[1]).toBe(10)
    expect(typeof value[1]).toBe("number")
  })
})
