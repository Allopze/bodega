import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { normalizeEppRow, parseEppWorkbook } from "./epp-import"

describe("normalizeEppRow", () => {
  it("extracts color and size from a messy EPP name", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL TALLA M", unitOfMeasure: "uni" })

    expect(result.name).toBe("Guante Nitrilo")
    expect(result.unitOfMeasure).toBe("unidad")
    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla", value: "M" },
      { name: "Material", value: "Nitrilo" },
    ]))
    expect(result.issues).toEqual([])
  })

  it("blocks contradictory alternative colors", () => {
    const result = normalizeEppRow({ name: "CASCO ROJO / BLANCO", unitOfMeasure: "unidad" })
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "blocking" })]))
  })

  it("does not mistake an M-series model for a size when model is explicit", () => {
    const result = normalizeEppRow({ name: "RESPIRADOR M-200", model: "M-200", unitOfMeasure: "unidad" })
    expect(result.attributes.some((attribute) => attribute.name === "Talla")).toBe(false)
  })

  it("matches EPP type regardless of accents in the product name", () => {
    const result = normalizeEppRow({ name: "PANTALÓN DE TRABAJO", unitOfMeasure: "unidad" })
    expect(result.eppType).toBe("pantalon")
    expect(result.issues).toEqual([])
  })

  it("keeps variant identity separate from family identity", () => {
    const blue = normalizeEppRow({ name: "GUANTE NITRILO AZUL TALLA M", unitOfMeasure: "unidad" })
    const red = normalizeEppRow({ name: "GUANTE NITRILO ROJO TALLA M", unitOfMeasure: "unidad" })

    expect(blue.identityKey).not.toBe(red.identityKey)
    expect(blue.familyIdentityKey).toBe(red.familyIdentityKey)
  })
})

describe("parseEppWorkbook", () => {
  it("accepts flexible headers without requiring a SKU", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("EPP")
    sheet.addRow(["Producto", "Color", "Talla", "Unidad", "Código"])
    sheet.addRow(["Casco", "Blanco", "M", "uni", "proveedor-1"])

    const parsed = await parseEppWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))

    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]?.values).toMatchObject({ name: "Casco", color: "Blanco", size: "M", unitOfMeasure: "uni", sourceCode: "proveedor-1" })
  })
})
