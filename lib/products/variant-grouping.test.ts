import { describe, expect, it } from "vitest"
import { formatProductVariant, groupProductVariants } from "./variant-grouping"

const variants = [
  { id: "casco-amarillo", name: "Casco seguridad", sku: "CAS-AMA", attributes: [{ name: "Color", options: '["Amarillo"]' }] },
  { id: "casco-blanco", name: "CASCO SEGURIDAD", sku: "CAS-BLA", attributes: [{ name: "Color", options: '["Blanco"]' }] },
  { id: "guante", name: "Guante anticorte", sku: "GUA-001", attributes: [] },
]

describe("product variant grouping", () => {
  it("groups catalog products with the same name into one selectable item", () => {
    const groups = groupProductVariants(variants)

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ name: "Casco seguridad" })
    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["casco-amarillo", "casco-blanco"])
  })

  it("uses the configured attribute values as the variant label", () => {
    const variant = variants[0]
    expect(variant).toBeDefined()
    expect(formatProductVariant(variant?.attributes ?? [], variant?.sku ?? "")).toBe("Color: Amarillo")
  })
})
