import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { validateLoadedPdtpWorkbook, validatePdtpXlsxEnvelope } from "./xlsx-security"

async function workbookBuffer(sheetCount = 1) {
  const workbook = new ExcelJS.Workbook()
  for (let index = 1; index <= sheetCount; index++) workbook.addWorksheet(`Hoja ${index}`).addRow(["PDTP"])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("PDTP XLSX upload security", () => {
  it("accepts a bounded real XLSX envelope", async () => {
    const buffer = await workbookBuffer()
    expect(validatePdtpXlsxEnvelope({
      name: "programa.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.length,
      buffer,
    })).toMatchObject({ entryCount: expect.any(Number), totalUncompressedBytes: expect.any(Number) })
  })

  it("rejects legacy XLS, a corrupt body and an invalid MIME type", async () => {
    const buffer = await workbookBuffer()
    expect(() => validatePdtpXlsxEnvelope({ name: "programa.xls", type: "application/vnd.ms-excel", size: buffer.length, buffer })).toThrow(/\.xls no está permitido/i)
    const corrupt = Buffer.from("no es un zip")
    expect(() => validatePdtpXlsxEnvelope({ name: "programa.xlsx", type: "application/octet-stream", size: corrupt.length, buffer: corrupt })).toThrow(/firma zip\/xlsx/i)
    expect(() => validatePdtpXlsxEnvelope({ name: "programa.xlsx", type: "text/plain", size: buffer.length, buffer })).toThrow(/mime/i)
  })

  it("rejects a ZIP entry that declares unsafe expansion", async () => {
    const buffer = Buffer.from(await workbookBuffer())
    const centralOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(centralOffset).toBeGreaterThanOrEqual(0)
    buffer.writeUInt32LE(21 * 1024 * 1024, centralOffset + 24)
    expect(() => validatePdtpXlsxEnvelope({
      name: "programa.xlsx",
      type: "application/octet-stream",
      size: buffer.length,
      buffer,
    })).toThrow(/parte interna.*límite/i)
  })

  it("rejects a loaded workbook beyond the worksheet resource limit", () => {
    const workbook = new ExcelJS.Workbook()
    for (let index = 1; index <= 33; index++) workbook.addWorksheet(`Hoja ${index}`)
    expect(() => validateLoadedPdtpWorkbook(workbook)).toThrow(/entre 1 y 32 hojas/i)
  })
})
