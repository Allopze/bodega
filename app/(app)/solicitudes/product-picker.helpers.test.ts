import { describe, expect, it } from "vitest"
import { filterProductsForPicker, groupProductsForPicker } from "./product-picker.helpers"
import type { ProductOption } from "./request-form.types"

const products: ProductOption[] = [
  {
    id: "prod-casco",
    sku: "EPP-001",
    name: "CASCO DE SEGURIDAD",
    unitOfMeasure: "unidad",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "EPP",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: null,
    attributes: [],
  },
  {
    id: "prod-guantes",
    sku: "EPP-002",
    name: "Guantes anticorte",
    unitOfMeasure: "par",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "EPP",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: null,
    attributes: [],
  },
  {
    id: "prod-casco-blanco",
    sku: "EPP-003",
    name: "Casco de seguridad",
    unitOfMeasure: "unidad",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    categoryName: "EPP",
    referencePrice: null,
    familyId: null,
    preferredSupplierId: null,
    attributes: [{ id: "color", name: "Color", isRequired: true, drivesQuantity: false, type: "select", options: '["Blanco"]' }],
  },
]

describe("filterProductsForPicker", () => {
  it("matches product names regardless of uppercase/lowercase", () => {
    expect(filterProductsForPicker(products, "casco").map((p) => p.id)).toEqual(["prod-casco", "prod-casco-blanco"])
  })

  it("matches product names regardless of accents", () => {
    expect(filterProductsForPicker(products, "seguridad").map((p) => p.id)).toEqual(["prod-casco", "prod-casco-blanco"])
  })

  it("shows same-name variants as one catalog choice", () => {
    const groups = groupProductsForPicker(products, "casco")

    expect(groups).toHaveLength(1)
    expect(groups[0]?.variants.map((product) => product.id)).toEqual(["prod-casco", "prod-casco-blanco"])
  })
})
