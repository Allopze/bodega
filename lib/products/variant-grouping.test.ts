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

  it("groups by familyId when the catalog provides the canonical family", () => {
    const groups = groupProductVariants([
      { id: "casco-amarillo", name: "Casco seguridad", sku: "CAS-AMA", familyId: "family-casco", attributes: [{ name: "Color", options: '["Amarillo"]' }] },
      { id: "casco-blanco", name: "CASCO SEGURIDAD", sku: "CAS-BLA", familyId: "family-casco", attributes: [{ name: "Color", options: '["Blanco"]' }] },
      { id: "otro-casco", name: "Casco seguridad", sku: "CAS-OTRO", familyId: "family-otro", attributes: [] },
    ])

    expect(groups.map((group) => [group.id, group.variants.map((variant) => variant.id)])).toEqual([
      ["family-casco", ["casco-amarillo", "casco-blanco"]],
      ["family-otro", ["otro-casco"]],
    ])
  })
})


describe("identidad completa de la variante", () => {
  it("muestra talla, color y medida sin inventar valores de plantillas", async () => {
    const { formatVariantProductName } = await import("./variant-grouping")
    expect(formatVariantProductName("Chaqueta", [
      { name: "Talla", type: "select", options: '["M"]' },
      { name: "Color", type: "select", options: '["Azul"]' },
      { name: "Medida", type: "select", options: '["1,5 m"]' },
      { name: "Material", type: "select", options: '["Cuero","Tela"]' },
      { name: "Observación", type: "text", options: "Molde antiguo" },
    ])).toBe("Chaqueta · Talla: M · Color: Azul · Medida: 1,5 m")
  })
  it("da prioridad al registro histórico por nombre normalizado", async () => {
    const { formatVariantProductName } = await import("./variant-grouping")
    expect(formatVariantProductName("Casco", [{ name: "Color", options: '["Rojo"]' }], [
      { name: " CÓLOR ", value: "Azul" }, { name: "Talla", value: "M" },
    ])).toBe("Casco ·  CÓLOR : Azul · Talla: M")
  })
})
