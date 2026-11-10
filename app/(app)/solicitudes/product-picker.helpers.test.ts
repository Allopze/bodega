import { describe, expect, it } from "vitest"
import { filterProductsForPicker, groupProductsForPicker, type PickerOption } from "./product-picker.helpers"
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
    // `prod-casco` no declara ningún atributo, así que va al final de su familia:
    // el orden lo fija `compareVariantsForDisplay` y ya no el de la consulta.
    expect(groups[0]?.variants.map((product) => product.id)).toEqual(["prod-casco-blanco", "prod-casco"])
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

describe("filterProductsForPicker: textos extra (N° de parte, marca)", () => {
  const option = (id: string, name: string, searchTerms: string[], sku = `RPT-${id}`): PickerOption => ({
    id, sku, name, familyId: id, attributes: [], searchTerms,
  })
  const parts = [
    option("1", "Filtro de aceite", ["1R-0750", "Caterpillar"]),
    option("2", "Filtro de aire", ["AF 25", "Donaldson"]),
    option("3", "Pastilla de freno", []),
  ]

  it("encuentra por N° de parte o marca, sin importar mayúsculas ni tildes", () => {
    expect(filterProductsForPicker(parts, "caterpillar").map((p) => p.id)).toEqual(["1"])
    expect(filterProductsForPicker(parts, "DONALDSON").map((p) => p.id)).toEqual(["2"])
    expect(filterProductsForPicker(parts, "1R-0750").map((p) => p.id)).toEqual(["1"])
  })

  it("ignora guiones y espacios del N° de parte: «1r0750» y «af25» lo encuentran", () => {
    expect(filterProductsForPicker(parts, "1r0750").map((p) => p.id)).toEqual(["1"])
    expect(filterProductsForPicker(parts, "af25").map((p) => p.id)).toEqual(["2"])
    expect(filterProductsForPicker(parts, "1R 0750").map((p) => p.id)).toEqual(["1"])
  })

  it("una búsqueda de sólo signos no empareja todo por quedar vacía al compactarla", () => {
    expect(filterProductsForPicker(parts, "...")).toEqual([])
  })

  it("sin búsqueda devuelve todo y sin textos extra se comporta como siempre", () => {
    expect(filterProductsForPicker(parts, "  ")).toHaveLength(3)
    expect(filterProductsForPicker(parts, "pastilla").map((p) => p.id)).toEqual(["3"])
    // El SKU sigue buscándose tal cual.
    expect(filterProductsForPicker(parts, "rpt-2").map((p) => p.id)).toEqual(["2"])
  })

  it("dos repuestos con el mismo nombre son dos opciones: cada uno es su propia familia", () => {
    const twins = [option("a", "Filtro de aceite", ["1R-0750"]), option("b", "Filtro de aceite", ["LF-3000"])]
    const groups = groupProductsForPicker(twins, "filtro")
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.variants[0]!.id)).toEqual(["a", "b"])
  })
})
