import { describe, expect, it } from "vitest"
import { formatProductAttributeNames } from "./product-list.helpers"

describe("formatProductAttributeNames", () => {
  it("lists the product characteristics in their configured order", () => {
    expect(formatProductAttributeNames([
      { name: "Color", sortOrder: 1, options: null },
      { name: "Talla", sortOrder: 0, options: null },
    ])).toBe("Talla · Color")
  })

  it("returns the empty-state marker when the product has no characteristics", () => {
    expect(formatProductAttributeNames([])).toBe("—")
  })
})
