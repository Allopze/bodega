import { describe, it, expect } from "vitest"
import {
  parseAttributeOptions,
  buildAttrsFromProduct,
} from "@/app/(app)/solicitudes/request-form.helpers"
import {
  formatProductVariant,
  groupProductVariants,
} from "@/lib/products/variant-grouping"
import type { ProductOption } from "@/app/(app)/solicitudes/request-form.types"

describe("parseAttributeOptions", () => {
  it("parses JSON array", () => {
    expect(parseAttributeOptions('["S","M","L","XL"]')).toEqual(["S", "M", "L", "XL"])
  })

  it("returns empty array for null/undefined", () => {
    expect(parseAttributeOptions(null)).toEqual([])
    expect(parseAttributeOptions(undefined)).toEqual([])
  })

  it("handles comma-separated legacy text", () => {
    expect(parseAttributeOptions("S, M, L, XL")).toEqual(["S", "M", "L", "XL"])
  })
})

describe("buildAttrsFromProduct", () => {
  const makeProduct = (attrs: ProductOption["attributes"]): ProductOption => ({
    id: "p-1", sku: "SKU-1", name: "Test", isEpp: true,
    unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null,
    preferredSupplierId: null, attributes: attrs,
  })

  it("pre-selects value when only one option", () => {
    const prod = makeProduct([
      { id: "a-1", name: "Talla", type: "select", isRequired: true, options: '["Única"]' },
    ])
    const attrs = buildAttrsFromProduct(prod)
    expect(attrs[0]!.value).toBe("Única")
  })

  it("leaves value empty when multiple options", () => {
    const prod = makeProduct([
      { id: "a-1", name: "Talla", type: "select", isRequired: true, options: '["S","M","L"]' },
    ])
    const attrs = buildAttrsFromProduct(prod)
    expect(attrs[0]!.value).toBe("")
  })
})

describe("formatProductVariant", () => {
  it("formats single attribute", () => {
    expect(formatProductVariant(
      [{ name: "Talla", options: JSON.stringify(["M"]) }],
      "SKU-001",
    )).toBe("Talla: M")
  })

  it("joins multiple attributes with ·", () => {
    expect(formatProductVariant(
      [
        { name: "Talla", options: JSON.stringify(["M", "L"]) },
        { name: "Color", options: JSON.stringify(["Azul"]) },
      ],
      "SKU-001",
    )).toBe("Talla: M / L · Color: Azul")
  })
})

describe("groupProductVariants", () => {
  it("groups differently-named products sharing the same familyId", () => {
    const products: ProductOption[] = [
      { id: "p-1", sku: "C-M", name: "Casco M", isEpp: true, unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: "family-casco", preferredSupplierId: null, attributes: [] },
      { id: "p-2", sku: "C-L", name: "Casco L", isEpp: true, unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: "family-casco", preferredSupplierId: null, attributes: [] },
    ]
    const groups = groupProductVariants(products)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.variants).toHaveLength(2)
  })

  it("falls back to normalized name grouping when familyId is null", () => {
    const products: ProductOption[] = [
      { id: "p-1", sku: "C-1", name: "Casco", isEpp: true, unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null, attributes: [] },
      { id: "p-2", sku: "C-2", name: "casco", isEpp: true, unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null, attributes: [] },
      { id: "p-3", sku: "G-1", name: "Guante", isEpp: true, unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null, attributes: [] },
    ]
    const groups = groupProductVariants(products)
    expect(groups).toHaveLength(2)
  })
})
