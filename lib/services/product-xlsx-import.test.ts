import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { parseProductImportWorkbook } from "./product-xlsx-import"

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("EPP")
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

describe("parseProductImportWorkbook", () => {
  it("parses EPP products from an XLSX with friendly column headers", async () => {
    const buffer = await workbookBuffer([
      ["SKU", "Nombre", "Proveedor", "Precio", "Atributos", "Descripción"],
      ["casco-001", "CASCO BLANCO", "TRECK", "$12.500", "Talla: M; Color: Blanco", "Casco certificado"],
      ["guante-001", "Guante cabritilla", "APRO", 3990, "Talla: L", ""],
    ])

    const parsed = await parseProductImportWorkbook(buffer)

    expect(parsed.items).toEqual([
      {
        rowNumber: 2,
        sku: "CASCO-001",
        name: "CASCO BLANCO",
        description: "Casco certificado",
        supplierName: "TRECK",
        price: 12500,
        unitOfMeasure: "unidad",
        categoryName: null,
        attributes: [
          { name: "Talla", value: "M" },
          { name: "Color", value: "Blanco" },
        ],
      },
      {
        rowNumber: 3,
        sku: "GUANTE-001",
        name: "Guante cabritilla",
        description: null,
        supplierName: "APRO",
        price: 3990,
        unitOfMeasure: "unidad",
        categoryName: null,
        attributes: [{ name: "Talla", value: "L" }],
      },
    ])
    expect(parsed.errors).toEqual([])
  })

  it("reports rows missing required SKU or product name", async () => {
    const buffer = await workbookBuffer([
      ["SKU", "Nombre", "Proveedor"],
      ["", "Casco", "TRECK"],
      ["EPP-002", "", "TRECK"],
    ])

    const parsed = await parseProductImportWorkbook(buffer)

    expect(parsed.items).toEqual([])
    expect(parsed.errors).toEqual([
      "Fila 2: SKU es obligatorio.",
      "Fila 3: Nombre es obligatorio.",
    ])
  })
})
