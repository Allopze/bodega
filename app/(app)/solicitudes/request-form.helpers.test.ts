import { describe, expect, it } from "vitest"
import type { ProductOption } from "./request-form.types"
import { buildAttrsFromProduct } from "./request-form.helpers"

describe("buildAttrsFromProduct", () => {
  it("accepts legacy comma/newline select options for EPP attributes", () => {
    const product: ProductOption = {
      id: "prod-epp",
      sku: "EPP-001",
      name: "Guante nitrilo",
      isEpp: true,
      unitOfMeasure: "par",
      categoryName: "EPP",
      referencePrice: null,
      preferredSupplierId: null,
      attributes: [
        { id: "attr-size", name: "Talla", type: "select", isRequired: true, options: "S, M, L" },
        { id: "attr-color", name: "Color", type: "select", isRequired: true, options: "Negro\nAzul" },
      ],
    }

    const attrs = buildAttrsFromProduct(product)

    expect(attrs).toEqual([
      expect.objectContaining({ attributeName: "Talla", options: ["S", "M", "L"] }),
      expect.objectContaining({ attributeName: "Color", options: ["Negro", "Azul"] }),
    ])
  })

  it("preselects the sole attribute values of a catalog variant", () => {
    const product: ProductOption = {
      id: "casco-amarillo", sku: "CAS-AMA", name: "Casco", isEpp: true,
      unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, preferredSupplierId: null,
      attributes: [{ id: "color", name: "Color", type: "select", isRequired: true, options: '["Amarillo"]' }],
    }

    expect(buildAttrsFromProduct(product)[0]).toMatchObject({ attributeName: "Color", value: "Amarillo" })
  })
})
