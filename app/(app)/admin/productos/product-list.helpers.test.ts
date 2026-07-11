import { describe, expect, it } from "vitest"
import { formatProductAttributeNames, getProductWarnings, getFamilyWarnings, type ProductWarningInput, type FamilyWarningInput } from "./product-list.helpers"

describe("formatProductAttributeNames", () => {
  it("lists the product characteristics in their configured order", () => {
    expect(formatProductAttributeNames([
      { name: "Color", sortOrder: 1, options: null },
      { name: "Talla", sortOrder: 0, options: null },
    ])).toBe("Talla · Color")
  })

  it("returns the empty-state marker when the product has no characteristics", () => {
    expect(formatProductAttributeNames([])).toBe("—")
  })
})

describe("getProductWarnings", () => {
  function baseProduct(overrides: Partial<ProductWarningInput> = {}): ProductWarningInput {
    return {
      isEpp: false,
      requiresPrevencion: false,
      referencePrice: 1000,
      hasPreferredSupplier: true,
      attributes: [],
      ...overrides,
    }
  }

  it("returns no warnings for a fully configured non-EPP product", () => {
    expect(getProductWarnings(baseProduct(), { isEpp: false, requiresPrevencion: false })).toEqual([])
  })

  it("warns when there is no reference price", () => {
    expect(getProductWarnings(baseProduct({ referencePrice: null }), undefined)).toContain("Sin precio referencial")
  })

  it("warns when there is no preferred supplier", () => {
    expect(getProductWarnings(baseProduct({ hasPreferredSupplier: false }), undefined)).toContain("Sin proveedor preferido")
  })

  it("warns when an EPP product has no required attributes", () => {
    const warnings = getProductWarnings(baseProduct({ isEpp: true, attributes: [] }), undefined)
    expect(warnings).toContain("EPP sin atributos obligatorios")
  })

  it("does not warn about required attributes for non-EPP products", () => {
    const warnings = getProductWarnings(baseProduct({ isEpp: false, attributes: [] }), undefined)
    expect(warnings).not.toContain("EPP sin atributos obligatorios")
  })

  it("does not warn when an EPP product has at least one required attribute", () => {
    const warnings = getProductWarnings(
      baseProduct({ isEpp: true, attributes: [{ name: "Talla", sortOrder: 0, options: null, isRequired: true }] }),
      undefined,
    )
    expect(warnings).not.toContain("EPP sin atributos obligatorios")
  })

  it("warns when the product's EPP/Prevención flags diverge from its category", () => {
    const warnings = getProductWarnings(baseProduct({ isEpp: true }), { isEpp: false, requiresPrevencion: false })
    expect(warnings).toContain("Difiere de la configuración EPP/Prevención de su categoría")
  })

  it("does not warn about divergence when the category is unknown", () => {
    const warnings = getProductWarnings(baseProduct({ isEpp: true }), undefined)
    expect(warnings).not.toContain("Difiere de la configuración EPP/Prevención de su categoría")
  })
})

describe("getFamilyWarnings", () => {
  function variant(overrides: Partial<FamilyWarningInput> = {}): FamilyWarningInput {
    return {
      id: "v1",
      isEpp: true,
      requiresPrevencion: false,
      referencePrice: 1000,
      hasPreferredSupplier: true,
      attributes: [{ name: "Talla", sortOrder: 0, options: null, isRequired: true }],
      ...overrides,
    }
  }

  it("returns no warnings for a single variant with no issues", () => {
    expect(getFamilyWarnings([variant()], { isEpp: true, requiresPrevencion: false })).toEqual([])
  })

  it("warns about mixed EPP requirements when some variants have required attributes and others don't", () => {
    const withAttrs = variant({ id: "v1", attributes: [{ name: "Talla", sortOrder: 0, options: null, isRequired: true }] })
    const withoutAttrs = variant({ id: "v2", attributes: [] })
    expect(getFamilyWarnings([withAttrs, withoutAttrs], { isEpp: true, requiresPrevencion: false }))
      .toContain("Familia con requisitos EPP mixtos entre variantes")
  })

  it("does not warn about mixed requirements for a single variant", () => {
    expect(getFamilyWarnings([variant({ id: "v1", attributes: [] })], { isEpp: true, requiresPrevencion: false }))
      .not.toContain("Familia con requisitos EPP mixtos entre variantes")
  })

  it("warns about variants without price", () => {
    const warnings = getFamilyWarnings([variant({ referencePrice: null })], undefined)
    expect(warnings).toContain("Variante(s) sin precio referencial")
  })

  it("warns about variants without preferred supplier", () => {
    const warnings = getFamilyWarnings([variant({ hasPreferredSupplier: false })], undefined)
    expect(warnings).toContain("Variante(s) sin proveedor preferido")
  })

  it("warns about category divergence at family level", () => {
    const warnings = getFamilyWarnings([variant({ isEpp: true })], { isEpp: false, requiresPrevencion: false })
    expect(warnings).toContain("Difiere de la configuración EPP/Prevención de su categoría")
  })
})
