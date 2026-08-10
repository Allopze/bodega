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
})
