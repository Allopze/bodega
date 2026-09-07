import { describe, expect, it } from "vitest"
import { catalogItemIssues } from "./service-items"
import { productVariantBatchSchema } from "@/app/(app)/admin/productos/actions/product-variant-batch.schema"

describe("contrato de variante", () => {
  it("rechaza pedir un color que no pertenece al producto elegido", () => {
    const rules = { name: "Casco", requiresWorker: false, attributes: [
      { id: "color", name: "Color", type: "select", isRequired: true, options: '["Azul"]' },
    ] }
    expect(catalogItemIssues(rules, { attributes: [{ attributeId: "color", attributeName: "Color", value: "Rojo" }] }))
      .toEqual(["Color no corresponde a los valores de la variante seleccionada"])
    expect(catalogItemIssues(rules, { attributes: [{ attributeId: "color", attributeName: "Color", value: "Azul" }] })).toEqual([])
  })

  const batch = {
    categoryId: "cat", familyName: "Cascos",
    attributes: [{ name: "Color", type: "select", options: '["Azul","Rojo"]', sortOrder: 0 }],
    variants: [
      { name: "Casco azul", attributes: [{ name: "Color", value: "Azul" }] },
      { name: "Casco rojo", attributes: [{ name: "Color", value: "Rojo" }] },
    ],
  }
  it("acepta combinaciones completas y normaliza la misma unidad que el alta individual", () => {
    const result = productVariantBatchSchema.safeParse({ ...batch, unitOfMeasure: " UNIDAD " })
    expect(result.success && result.data.unitOfMeasure).toBe("unidad")
  })
  it.each([
    [batch.variants[0], batch.variants[0]],
    [{ name: "Sin color", attributes: [] }],
    [{ name: "Otro", attributes: [{ name: "Color", value: "Verde" }] }],
    [{ name: "Duplicado", attributes: [{ name: "Color", value: "Azul" }, { name: "CÓLOR", value: "Rojo" }] }],
  ])("rechaza combinaciones incompletas, ajenas o duplicadas: %j", (...variants) => {
    expect(productVariantBatchSchema.safeParse({ ...batch, variants }).success).toBe(false)
  })
})
