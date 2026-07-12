import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { parseCatalogWorkbook } from "./catalog-import"

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Productos")
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

describe("parseCatalogWorkbook", () => {
  it("marks rows with an ID as updates and rows without as creates", async () => {
    const buffer = await workbookBuffer([
      ["ID", "Nombre", "Categoría"],
      ["prod-1", "Casco blanco", "EPP"],
      ["", "Guante cabritilla", "EPP"],
    ])

    const parsed = await parseCatalogWorkbook(buffer)

    expect(parsed.ok).toBe(true)
    expect(parsed.rows.map((r) => r.decision)).toEqual(["update", "create"])
    expect(parsed.rows.every((r) => r.error === null)).toBe(true)
  })

  it("rejects a file missing the required Nombre column", async () => {
    const buffer = await workbookBuffer([
      ["ID", "Categoría"],
      ["prod-1", "EPP"],
    ])

    const parsed = await parseCatalogWorkbook(buffer)

    expect(parsed.ok).toBe(false)
    expect(parsed.errors[0]).toContain("Nombre")
  })

  it("flags rows missing the product name with a row-specific error instead of importing blind", async () => {
    const buffer = await workbookBuffer([
      ["ID", "Nombre", "Categoría"],
      ["", "", "EPP"],
    ])

    const parsed = await parseCatalogWorkbook(buffer)

    expect(parsed.ok).toBe(true)
    expect(parsed.rows[0]?.decision).toBe("skip")
    expect(parsed.rows[0]?.error).toContain("falta el nombre")
  })
})
