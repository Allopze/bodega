import { describe, expect, it } from "vitest"
import { SIZE_FAMILIES, sizeCatalogRows, sizeFamilyByAttributeName, sizeFamilyForWorkerField } from "./size-catalog"
import { compareSizeLabels, normalizeSizeLabel, isSizeAttributeName, workerSizeFieldFor } from "./product-size"

describe("SIZE_FAMILIES", () => {
  it("declara familias sin códigos repetidos", () => {
    for (const family of SIZE_FAMILIES) {
      const normalized = family.codes.map(normalizeSizeLabel)
      expect(new Set(normalized).size, `familia ${family.family}`).toBe(normalized.length)
    }
  })

  it("todas sus familias tienen un nombre de atributo reconocido como talla", () => {
    for (const family of SIZE_FAMILIES) {
      expect(isSizeAttributeName(family.attributeName), family.attributeName).toBe(true)
    }
  })

  it("cada familia se puede cruzar con un campo del padrón del trabajador", () => {
    // Si una familia no mapea a ningún campo, sus variantes nunca podrán
    // sugerir la talla habitual — que es el caso que tenía «Talla casco».
    for (const family of SIZE_FAMILIES) {
      expect(workerSizeFieldFor(family.attributeName), family.attributeName).not.toBeNull()
    }
  })

  it("incluye la talla de casco, que el padrón guarda desde siempre", () => {
    const casco = SIZE_FAMILIES.find((family) => family.family === "casco")
    expect(casco).toBeDefined()
    expect(workerSizeFieldFor(casco!.attributeName)).toBe("sizeHelmet")
  })
})

describe("sizeFamilyForWorkerField", () => {
  it("cruza cada campo del padrón con su familia del catálogo", () => {
    expect(sizeFamilyForWorkerField("sizeTop")).toBe("ropa")
    expect(sizeFamilyForWorkerField("sizeBottom")).toBe("pantalon")
    expect(sizeFamilyForWorkerField("sizeShoe")).toBe("calzado")
    expect(sizeFamilyForWorkerField("sizeGloves")).toBe("guantes")
    expect(sizeFamilyForWorkerField("sizeHelmet")).toBe("casco")
  })

  it("cubre los cinco campos del padrón sin repetir familia", () => {
    // El formulario de trabajadores ofrece un selector por campo: si dos
    // campos resolvieran a la misma familia, uno mostraría las tallas del otro.
    const fields = ["sizeTop", "sizeBottom", "sizeShoe", "sizeGloves", "sizeHelmet"] as const
    const families = fields.map(sizeFamilyForWorkerField)
    expect(families.every(Boolean)).toBe(true)
    expect(new Set(families).size).toBe(fields.length)
  })
})

describe("sizeCatalogRows", () => {
  it("numera el orden de presentación con el mismo comparador que usa la interfaz", () => {
    // El `display_order` de `size_catalog` es un derivado de `compareSizeLabels`,
    // no una lista escrita a mano: dos criterios distintos volverían a producir
    // el `L M S XL XS` que esta auditoría vino a corregir.
    const rows = sizeCatalogRows()
    for (const family of SIZE_FAMILIES) {
      const ordered = rows
        .filter((row) => row.family === family.family)
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((row) => row.code)

      expect(ordered, family.family).toEqual([...family.codes].sort(compareSizeLabels))
    }
  })

  it("ordena la ropa por escala y el calzado por número", () => {
    const rows = sizeCatalogRows()
    const codes = (family: string) => rows
      .filter((row) => row.family === family)
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((row) => row.code)

    expect(codes("ropa")).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"])
    expect(codes("calzado").slice(0, 4)).toEqual(["36", "37", "38", "39"])
  })

  it("empieza cada familia en cero y numera sin saltos", () => {
    const rows = sizeCatalogRows()
    for (const family of SIZE_FAMILIES) {
      const orders = rows.filter((row) => row.family === family.family).map((row) => row.displayOrder)
      expect(orders.sort((a, b) => a - b), family.family).toEqual(orders.map((_, index) => index))
    }
  })

  it("produce una fila por talla declarada", () => {
    const total = SIZE_FAMILIES.reduce((sum, family) => sum + family.codes.length, 0)
    expect(sizeCatalogRows()).toHaveLength(total)
  })
})

describe("sizeFamilyByAttributeName", () => {
  it("resuelve el atributo del catálogo sin importar mayúsculas", () => {
    expect(sizeFamilyByAttributeName("Talla calzado")?.family).toBe("calzado")
    expect(sizeFamilyByAttributeName("talla calzado")?.family).toBe("calzado")
    expect(sizeFamilyByAttributeName("Talla casco")?.family).toBe("casco")
  })

  it("devuelve undefined para un atributo que no es del catálogo", () => {
    expect(sizeFamilyByAttributeName("Color")).toBeUndefined()
  })
})
