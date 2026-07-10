import { describe, expect, it } from "vitest"
import { getEditableItemAttributes } from "./item-editor-attributes.helpers"

describe("getEditableItemAttributes", () => {
  it("hides fields already determined by the selected variant", () => {
    const fields = getEditableItemAttributes([
      { attributeId: "color", attributeName: "Color", value: "Claro", isRequired: true, type: "select", options: ["Claro"] },
      { attributeId: "model", attributeName: "Modelo", value: "FX III", isRequired: true, type: "select", options: ["FX III"] },
    ])

    expect(fields).toEqual([])
  })

  it("keeps attributes requiring an additional choice or text", () => {
    const fields = getEditableItemAttributes([
      { attributeId: "talla", attributeName: "Talla", value: "", isRequired: true, type: "select", options: ["S", "M", "L"] },
      { attributeId: "detalle", attributeName: "Detalle", value: "", isRequired: false, type: "text", options: [] },
    ])

    expect(fields.map(({ attribute }) => attribute.attributeName)).toEqual(["Talla", "Detalle"])
  })
})
