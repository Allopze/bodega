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
      { name: "Talla guantes", value: "M", sizeFamily: "guantes" },
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
      { name: "Talla guantes", value: "S, M, L, XL", values: ["S", "M", "L", "XL"], sizeFamily: "guantes" },
      { name: "Material", value: "Nitrilo" },
    ]))
    expect(result.issues).toEqual([])
    expect(result.name).toBe("Guante Nitrilo")
    expect(result.identityKey).not.toContain("talla")
  })

  it("handles multi-talla calzado from comma-separated column", () => {
    const result = normalizeEppRow({ name: "BOTIN SEGURIDAD", unitOfMeasure: "par", size: "38, 39, 40, 41, 42" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla calzado", value: "38, 39, 40, 41, 42", values: ["38", "39", "40", "41", "42"], sizeFamily: "calzado" },
    ]))
    expect(result.issues).toEqual([])
    expect(result.identityKey).not.toContain("talla")
  })

  it("single talla from column still works (backward compat)", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "M", color: "Azul" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Color", value: "Azul" },
      { name: "Talla guantes", value: "M", sizeFamily: "guantes" },
    ]))
    // La talla singular sigue formando parte de la identidad de la variante.
    expect(result.identityKey).toContain("talla guantes=m")
  })

  it("preserves multi-talla through review round-trip", () => {
    const original = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })
    const reParsed = normalizeEppRow({ name: "GUANTE NITRILO AZUL", unitOfMeasure: "unidad", size: "S, M, L, XL" })

    expect(original.identityKey).toBe(reParsed.identityKey)
    expect(original.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Talla guantes", values: ["S", "M", "L", "XL"] }),
    ]))
  })

  it("canoniza la talla escrita como la trae la planilla real", () => {
    const guante = normalizeEppRow({ name: "GUANTE CABRITILLA SIN FORRO", unitOfMeasure: "par", size: "T/L" })
    expect(guante.attributes).toEqual(expect.arrayContaining([
      { name: "Talla guantes", value: "L", sizeFamily: "guantes" },
    ]))
    expect(guante.issues).toEqual([])

    const overol = normalizeEppRow({ name: "OVEROL ACTIVEX PILOTO POPLIN", unitOfMeasure: "unidad", size: "XXXL" })
    expect(overol.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "3XL", sizeFamily: "ropa" },
    ]))
  })

  it("acepta con advertencia una talla que el catálogo de la familia no declara", () => {
    const result = normalizeEppRow({ name: "GUANTES DE CABRITILLA", unitOfMeasure: "par", size: "Talla 9-10" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla guantes", value: "9/10", sizeFamily: "guantes" },
    ]))
    expect(result.issues).toEqual([
      { severity: "warning", message: "La talla «9/10» no está en el catálogo de la familia guantes." },
    ])
  })

  it("advierte cuando un pantalón trae numeración de cintura", () => {
    // Consecuencia visible de mapear `pantalon` a la escala de letras: una
    // cintura 32 no está en `ropa`, entra igual y queda advertida para que
    // alguien decida si esa familia debe sizarse por `Talla inferior`.
    const result = normalizeEppRow({ name: "PANTALON DE TRABAJO", unitOfMeasure: "unidad", size: "32" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "32", sizeFamily: "ropa" },
    ]))
    expect(result.issues).toEqual([
      { severity: "warning", message: "La talla «32» no está en el catálogo de la familia ropa." },
    ])
  })

  it("no le pone familia a la talla de un ítem que no se sizea", () => {
    const result = normalizeEppRow({ name: "LENTE ACTIVEX FX III SELLADO", unitOfMeasure: "unidad", size: "M" })

    expect(result.attributes).toEqual(expect.arrayContaining([
      { name: "Talla", value: "M", sizeFamily: null },
    ]))
    expect(result.issues).toEqual([])
  })

  it("deja un solo atributo de talla cuando la columna de atributos ya trae una", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO", unitOfMeasure: "par", attributes: "Talla: M; Marca: Showa" })

    const sizeAttributes = result.attributes.filter((attribute) => attribute.name.startsWith("Talla"))
    expect(sizeAttributes).toEqual([{ name: "Talla guantes", value: "M", sizeFamily: "guantes" }])
    expect(result.attributes).toEqual(expect.arrayContaining([{ name: "Marca", value: "Showa" }]))
  })

  it("no deja atributo de talla cuando la celda no contiene ninguna talla escribible", () => {
    const result = normalizeEppRow({ name: "GUANTE NITRILO", unitOfMeasure: "par", size: "." })

    expect(result.attributes.some((attribute) => attribute.name.startsWith("Talla"))).toBe(false)
    expect(result.issues).toEqual([])
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
      expect.objectContaining({ name: "Talla guantes", values: ["S", "M", "L"], sizeFamily: "guantes" }),
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
