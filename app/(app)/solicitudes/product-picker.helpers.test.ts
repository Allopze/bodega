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

describe("groupProductsForPicker: el recorte cuenta familias, no filas", () => {
  /** Una familia de EPP con `variantCount` tallas: muchas filas, una sola familia. */
  function familyWithVariants(familyId: string, name: string, variantCount: number): ProductOption[] {
    return Array.from({ length: variantCount }, (_, i) => ({
      id: `${familyId}-${i}`,
      sku: `EPP-${familyId}-${i}`,
      name: `${name} T${i}`,
      unitOfMeasure: "unidad",
      isEpp: true,
      isService: false, requiresWorker: false, equipmentKind: null,
      categoryName: "EPP",
      referencePrice: null,
      familyId,
      preferredSupplierId: null,
      attributes: [],
    }))
  }

  it("sin búsqueda, 50 significa 50 familias y no 50 variantes", () => {
    // 60 familias × 10 tallas = 600 filas. Recortando antes de agrupar, las
    // primeras 50 filas eran apenas 5 familias.
    const many = Array.from({ length: 60 }, (_, f) =>
      familyWithVariants(`fam-${f}`, `Producto ${f}`, 10),
    ).flat()

    const groups = groupProductsForPicker(many, "")

    expect(groups).toHaveLength(50)
    expect(new Set(groups.map((g) => g.id)).size).toBe(50)
  })

  it("con búsqueda no recorta: el usuario ya acotó el universo", () => {
    const many = Array.from({ length: 60 }, (_, f) =>
      familyWithVariants(`fam-${f}`, `Producto ${f}`, 10),
    ).flat()

    // "Producto 1" matchea 1, 10-19 → 11 familias.
    const groups = groupProductsForPicker(many, "Producto 1")

    expect(groups).toHaveLength(11)
  })

  it("agrupa las variantes de una familia en una sola entrada", () => {
    const groups = groupProductsForPicker(familyWithVariants("fam-casco", "Casco", 8), "")

    expect(groups).toHaveLength(1)
    expect(groups[0]!.variants).toHaveLength(8)
  })
})
