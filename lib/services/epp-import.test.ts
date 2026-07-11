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

  it("handles multi-talla from comma-separated column", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla", value: "S, M, L, XL", values: ["S", "M", "L", "XL"] },
      { name: "Material", value: "Nitrilo" },
    ]))
    expect(result.issues).toEqual([])
    // canonical name should NOT include sizes
    expect(result.name).toBe("Guante Nitrilo")
    // identity key should NOT include multi-talla
    expect(result.identityKey).not.toContain("talla")
  })

  it("handles multi-talla calzado from comma-separated column", () => {
    const result = normalizeEppRow({ name: "BOTIN SEGURIDAD", unitOfMeasure: "par", size: "38, 39, 40, 41, 42" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla calzado", value: "38, 39, 40, 41, 42", values: ["38", "39", "40", "41", "42"] },
    ]))
    expect(result.issues).toEqual([])
    // identity key should NOT include multi-talla calzado
    expect(result.identityKey).not.toContain("talla")
  })

  it("single talla from column still works (backward compat)", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "M", color: "Azul" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla", value: "M" },
    ]))
    // single-talla still includes talla in identity key (backward compat)
    expect(result.identityKey).toContain("talla=m")
  })

  it("preserves multi-talla through review round-trip", () => {
    const original = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })
    const reParsed = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })

    expect(original.identityKey).toBe(reParsed.identityKey)
    expect(original.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Talla", values: ["S", "M", "L", "XL"] }),
    ]))
  })

  it("handles multi-color from comma-separated column", () => {
    const result = normalizeEppRow({ name: "CASCO SEGURIDAD", unitOfMeasure: "unidad", color: "Amarillo, Blanco, Naranjo" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Amarillo, Blanco, Naranjo", values: ["Amarillo", "Blanco", "Naranjo"] },
    ]))
    expect(result.issues).toEqual([])
    expect(result.name).toBe("Casco Seguridad")
    // identity key should NOT include multi-color
    expect(result.identityKey).not.toContain("color")
  })

  it("canonicalizes multi-color values when possible", () => {
    const result = normalizeEppRow({ name: "GUANTE SEGURIDAD", unitOfMeasure: "unidad", color: "AZUL, ROJO, VERDE" })

    // Colors are canonicalized (azul -> Azul, rojo -> Rojo, verde -> Verde)
    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul, Rojo, Verde", values: ["Azul", "Rojo", "Verde"] },
    ]))
  })

  it("handles multi-color + multi-talla together", () => {
    const result = normalizeEppRow({
      name: "GUANTE NITRILO",
      unitOfMeasure: "unidad",
      color: "Azul, Rojo, Verde",
      size: "S, M, L",
    })

    expect(result.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Color", values: ["Azul", "Rojo", "Verde"] }),
      expect.objectContaining({ name: "Talla", values: ["S", "M", "L"] }),
    ]))
    expect(result.issues).toEqual([])
    // Both multi-value attrs excluded from identity key
    expect(result.identityKey).not.toContain("color")
    expect(result.identityKey).not.toContain("talla")
  })

  it("single color from column still works (backward compat)", () => {
    const result = normalizeEppRow({ name: "CASCO", unitOfMeasure: "unidad", color: "Azul" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
    ]))
    // Single color still included in identity key (backward compat)
    expect(result.identityKey).toContain("color=azul")
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
