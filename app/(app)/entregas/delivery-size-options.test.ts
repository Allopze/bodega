import { describe, expect, it } from "vitest"
import { buildDeliveryStockGroups, requiresSizeChoice } from "./delivery-size-options"
import type { DeliveryStockProductOption } from "./delivery-form.types"

function stock(overrides: Partial<DeliveryStockProductOption> & { productId: string }): DeliveryStockProductOption {
  return {
    sourceWorksiteId: "ws-1",
    productName: "Zapato de seguridad SteelPro",
    productSku: null,
    isEpp: true,
    unitOfMeasure: "unidad",
    stockQuantity: 1,
    familyId: "fam-zapato",
    familyName: "Zapato de seguridad SteelPro",
    sizeLabel: null,
    sizeAttributeName: null,
    ...overrides,
  }
}

/** El caso real: una fila de catálogo por talla, todas con el mismo nombre. */
const shoeStock: DeliveryStockProductOption[] = [
  stock({ productId: "p-41", sizeLabel: "41", sizeAttributeName: "Talla calzado", stockQuantity: 4 }),
  stock({ productId: "p-43", sizeLabel: "43", sizeAttributeName: "Talla calzado", stockQuantity: 1 }),
  stock({ productId: "p-40", sizeLabel: "40", sizeAttributeName: "Talla calzado", stockQuantity: 2 }),
  stock({ productId: "p-42", sizeLabel: "42", sizeAttributeName: "Talla calzado", stockQuantity: 3 }),
]

describe("buildDeliveryStockGroups", () => {
  it("agrupa las variantes de una familia en un solo producto elegible", () => {
    const groups = buildDeliveryStockGroups(shoeStock)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe("Zapato de seguridad SteelPro")
    expect(groups[0]!.totalStock).toBe(10)
    expect(groups[0]!.sizeAttributeName).toBe("Talla calzado")
  })

  it("ofrece cada talla con su propia variante y su propio stock", () => {
    const [group] = buildDeliveryStockGroups(shoeStock)
    expect(group!.choices.map((choice) => [choice.sizeLabel, choice.productId, choice.stockQuantity])).toEqual([
      ["40", "p-40", 2],
      ["41", "p-41", 4],
      ["42", "p-42", 3],
      ["43", "p-43", 1],
    ])
  })

  it("ordena las tallas de ropa por escala y no alfabéticamente", () => {
    const groups = buildDeliveryStockGroups([
      stock({ productId: "p-l", productName: "Polera", familyId: "fam-polera", familyName: "Polera", sizeLabel: "L", sizeAttributeName: "Talla" }),
      stock({ productId: "p-xs", productName: "Polera", familyId: "fam-polera", familyName: "Polera", sizeLabel: "XS", sizeAttributeName: "Talla" }),
      stock({ productId: "p-xl", productName: "Polera", familyId: "fam-polera", familyName: "Polera", sizeLabel: "XL", sizeAttributeName: "Talla" }),
      stock({ productId: "p-m", productName: "Polera", familyId: "fam-polera", familyName: "Polera", sizeLabel: "M", sizeAttributeName: "Talla" }),
      stock({ productId: "p-s", productName: "Polera", familyId: "fam-polera", familyName: "Polera", sizeLabel: "S", sizeAttributeName: "Talla" }),
    ])
    expect(groups[0]!.choices.map((choice) => choice.sizeLabel)).toEqual(["XS", "S", "M", "L", "XL"])
  })

  it("agrupa por nombre cuando el catálogo no declara familia", () => {
    // Es el estado que deja el importador: quita la talla del nombre y la
    // guarda como atributo, así que las variantes sólo comparten el nombre.
    const groups = buildDeliveryStockGroups([
      stock({ productId: "p-40", familyId: null, familyName: null, sizeLabel: "40", sizeAttributeName: "Talla calzado" }),
      stock({ productId: "p-41", familyId: null, familyName: null, sizeLabel: "41", sizeAttributeName: "Talla calzado" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.choices).toHaveLength(2)
  })

  it("no pide talla en un producto que no la usa", () => {
    const groups = buildDeliveryStockGroups([
      stock({ productId: "p-casco", productName: "Casco de seguridad", familyId: "fam-casco", familyName: "Casco de seguridad", stockQuantity: 7 }),
    ])
    expect(groups[0]!.sizeAttributeName).toBeNull()
    expect(requiresSizeChoice(groups[0])).toBe(false)
    expect(groups[0]!.choices[0]!.sizeLabel).toBeNull()
  })

  it("no mezcla las variantes de familias distintas", () => {
    const groups = buildDeliveryStockGroups([
      ...shoeStock,
      stock({ productId: "g-m", productName: "Guante anticorte", familyId: "fam-guante", familyName: "Guante anticorte", sizeLabel: "M", sizeAttributeName: "Talla guantes" }),
    ])
    expect(groups.map((group) => group.label)).toEqual(["Guante anticorte", "Zapato de seguridad SteelPro"])
    expect(groups[0]!.choices).toHaveLength(1)
    expect(groups[1]!.choices).toHaveLength(4)
  })

  it("no mezcla el stock de bodegas distintas en la misma opción", () => {
    // La página filtra por bodega antes de agrupar; si además se agregara aquí,
    // el máximo ofrecido sería stock de otra faena.
    const groups = buildDeliveryStockGroups([
      stock({ productId: "p-42", sizeLabel: "42", sizeAttributeName: "Talla calzado", stockQuantity: 3 }),
      stock({ productId: "p-42", sourceWorksiteId: "ws-2", sizeLabel: "42", sizeAttributeName: "Talla calzado", stockQuantity: 9 }),
    ].filter((row) => row.sourceWorksiteId === "ws-1"))
    expect(groups[0]!.totalStock).toBe(3)
    expect(groups[0]!.choices).toHaveLength(1)
  })

  it("marca la talla habitual del trabajador sin excluir las demás", () => {
    const [group] = buildDeliveryStockGroups(shoeStock, { sizeShoe: "42" })
    expect(group!.habitualSize).toBe("42")
    expect(group!.habitualSizeMissing).toBe(false)
    expect(group!.choices.filter((choice) => choice.isHabitual).map((choice) => choice.sizeLabel)).toEqual(["42"])
    // Las otras siguen elegibles: una entrega excepcional es válida.
    expect(group!.choices).toHaveLength(4)
  })

  it("cruza la talla habitual aunque esté escrita de otra forma", () => {
    const [group] = buildDeliveryStockGroups(shoeStock, { sizeShoe: "T42" })
    expect(group!.choices.find((choice) => choice.isHabitual)?.productId).toBe("p-42")
  })

  it("usa el campo del padrón que corresponde al atributo", () => {
    // `sizeTop` es la talla de ropa: no debe sugerir una talla de calzado.
    const [group] = buildDeliveryStockGroups(shoeStock, { sizeTop: "42", sizeShoe: null })
    expect(group!.habitualSize).toBeNull()
    expect(group!.choices.some((choice) => choice.isHabitual)).toBe(false)
  })

  it("avisa cuando la talla habitual no tiene stock en la bodega", () => {
    const [group] = buildDeliveryStockGroups(shoeStock, { sizeShoe: "45" })
    expect(group!.habitualSize).toBe("45")
    expect(group!.habitualSizeMissing).toBe(true)
    expect(group!.choices.some((choice) => choice.isHabitual)).toBe(false)
  })

  it("muestra una variante sin talla al final de un grupo con tallas", () => {
    // Anomalía de catálogo: esconderla ocultaría stock físico real.
    const [group] = buildDeliveryStockGroups([
      ...shoeStock,
      stock({ productId: "p-sin", stockQuantity: 5 }),
    ])
    expect(group!.choices.at(-1)).toMatchObject({ productId: "p-sin", sizeLabel: null })
    expect(group!.totalStock).toBe(15)
  })

  it("no devuelve nada cuando la bodega no tiene stock", () => {
    expect(buildDeliveryStockGroups([])).toEqual([])
  })
})


it("exige elegir entre colores de una familia sin talla", () => {
  const groups = buildDeliveryStockGroups([
    stock({ productId: "azul", familyId: "casco", sizeLabel: null, sizeAttributeName: null, variantLabel: "Color: Azul" }),
    stock({ productId: "rojo", familyId: "casco", sizeLabel: null, sizeAttributeName: null, variantLabel: "Color: Rojo" }),
  ])
  expect(groups).toHaveLength(1)
  expect(requiresSizeChoice(groups[0])).toBe(true)
  expect(groups[0]?.choices.map((c) => c.variantLabel)).toEqual(["Color: Azul", "Color: Rojo"])
})
