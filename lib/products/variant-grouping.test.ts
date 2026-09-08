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

describe("orden de presentación de las variantes de una familia", () => {
  const family = (id: string, sku: string, attributes: Array<{ name: string; options: string }>) =>
    ({ id, name: "Prenda", sku, familyId: "family-1", attributes })

  it("ordena la escala de ropa por talla y no alfabéticamente", () => {
    const groups = groupProductVariants([
      family("l", "P-3", [{ name: "Talla", options: '["L"]' }]),
      family("xs", "P-1", [{ name: "Talla", options: '["XS"]' }]),
      family("2xl", "P-4", [{ name: "Talla", options: '["2XL"]' }]),
      family("m", "P-2", [{ name: "Talla", options: '["M"]' }]),
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["xs", "m", "l", "2xl"])
  })

  it("ordena las tallas numéricas por valor y no por texto", () => {
    const groups = groupProductVariants([
      family("diez", "C-1", [{ name: "Talla calzado", options: '["10"]' }]),
      family("nueve", "C-2", [{ name: "Talla calzado", options: '["9"]' }]),
      family("cuarenta", "C-3", [{ name: "Talla calzado", options: '["40"]' }]),
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["nueve", "diez", "cuarenta"])
  })

  it("trata XXXL y 3XL como la misma talla al ordenar", () => {
    const groups = groupProductVariants([
      family("cuatro", "P-1", [{ name: "Talla", options: '["4XL"]' }]),
      family("tres-largo", "P-2", [{ name: "Talla", options: '["XXXL"]' }]),
      family("s", "P-3", [{ name: "Talla", options: '["S"]' }]),
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["s", "tres-largo", "cuatro"])
  })

  it("pone las variantes con talla antes que las que no la declaran", () => {
    const groups = groupProductVariants([
      family("sin-talla", "P-9", [{ name: "Color", options: '["Azul"]' }]),
      family("con-talla", "P-1", [{ name: "Talla", options: '["M"]' }]),
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["con-talla", "sin-talla"])
  })

  it("pone las variantes sin ningún atributo al final de su familia", () => {
    const groups = groupProductVariants([
      // El SKU de la anónima ordena *antes* que la etiqueta de la identificada:
      // sin la regla explícita, el orden lo decidiría esa comparación de manzanas
      // con peras (un SKU contra un `Color: …`).
      { id: "anonima", name: "Casco", sku: "AAA-001", familyId: "family-1", attributes: [] },
      { id: "identificada", name: "Casco", sku: "EPP-003", familyId: "family-1", attributes: [{ name: "Color", options: '["Blanco"]' }] },
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["identificada", "anonima"])
  })

  it("desempata por SKU para que el orden no dependa de la consulta", () => {
    const groups = groupProductVariants([
      family("b", "P-2", [{ name: "Talla", options: '["M"]' }]),
      family("a", "P-1", [{ name: "Talla", options: '["M"]' }]),
    ])

    expect(groups[0]?.variants.map((variant) => variant.id)).toEqual(["a", "b"])
  })
})
