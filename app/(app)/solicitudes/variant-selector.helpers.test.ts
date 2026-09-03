import { describe, expect, it } from "vitest"
import { getSizeVariantPicker } from "./variant-selector.helpers"
import type { ProductOption } from "./request-form.types"

function variant(id: string, size: string, attributeName = "Talla calzado"): ProductOption {
  return {
    id,
    sku: `BOT-${size}`,
    name: "Botín de seguridad",
    isEpp: true,
    isService: false, requiresWorker: false, equipmentKind: null,
    unitOfMeasure: "par",
    categoryName: "Calzado",
    referencePrice: null,
    familyId: "botin-seguridad",
    preferredSupplierId: null,
    attributes: [{ id: `size-${size}`, name: attributeName, type: "select", isRequired: true, drivesQuantity: false, options: JSON.stringify([size]) }],
  }
}

describe("getSizeVariantPicker", () => {
  it("converts a size-only product family into one dropdown", () => {
    expect(getSizeVariantPicker([variant("36", "36"), variant("37", "37")])).toEqual({
      attributeName: "Talla calzado",
      choices: [{ id: "36", label: "36" }, { id: "37", label: "37" }],
    })
  })

  it("does not flatten families with incompatible or repeated size choices", () => {
    expect(getSizeVariantPicker([variant("36", "36"), variant("37", "37", "Talla guantes")])).toBeNull()
    expect(getSizeVariantPicker([variant("a", "M"), variant("b", "M")])).toBeNull()
  })

  it("descarta la familia cuando dos variantes son la misma talla escrita distinto", () => {
    // `42` y `42.0` no son dos opciones: son la misma talla en dos filas, y
    // ofrecerlas obligaría a elegir entre variantes indistinguibles.
    expect(getSizeVariantPicker([variant("a", "42"), variant("b", "42.0")])).toBeNull()
  })

  it("ordena las tallas por escala y no por el orden de la consulta", () => {
    const picker = getSizeVariantPicker([
      variant("l", "L", "Talla"), variant("xs", "XS", "Talla"),
      variant("m", "M", "Talla"), variant("xl", "XL", "Talla"),
      variant("s", "S", "Talla"),
    ])
    expect(picker?.choices.map((choice) => choice.label)).toEqual(["XS", "S", "M", "L", "XL"])
  })

  it("ordena las tallas numéricas por valor", () => {
    const picker = getSizeVariantPicker([
      variant("40", "40"), variant("9", "9"), variant("38", "38"), variant("10", "10"),
    ])
    expect(picker?.choices.map((choice) => choice.label)).toEqual(["9", "10", "38", "40"])
  })
})
