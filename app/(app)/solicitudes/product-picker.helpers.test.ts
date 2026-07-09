import { describe, expect, it } from "vitest"
import { filterProductsForPicker } from "./product-picker.helpers"
import type { ProductOption } from "./request-form.types"

const products: ProductOption[] = [
  {
    id: "prod-casco",
    sku: "EPP-001",
    name: "CASCO DE SEGURIDAD",
    unitOfMeasure: "unidad",
    isEpp: true,
    categoryName: "EPP",
    referencePrice: null,
    preferredSupplierId: null,
    attributes: [],
  },
  {
    id: "prod-guantes",
    sku: "EPP-002",
    name: "Guantes anticorte",
    unitOfMeasure: "par",
    isEpp: true,
    categoryName: "EPP",
    referencePrice: null,
    preferredSupplierId: null,
    attributes: [],
  },
]

describe("filterProductsForPicker", () => {
  it("matches product names regardless of uppercase/lowercase", () => {
    expect(filterProductsForPicker(products, "casco").map((p) => p.id)).toEqual(["prod-casco"])
  })

  it("matches product names regardless of accents", () => {
    expect(filterProductsForPicker(products, "seguridad").map((p) => p.id)).toEqual(["prod-casco"])
  })
})
