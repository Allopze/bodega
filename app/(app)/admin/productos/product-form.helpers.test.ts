import { describe, expect, it } from "vitest"
import { mergeProductAttribute, normalizeProductAttributeName, setPreferredSupplier } from "./product-form.helpers"
import type { SupplierRow } from "./product-form.types"

describe("product form attribute helpers", () => {
  it("normalizes accents, case and whitespace for attribute identity", () => {
    expect(normalizeProductAttributeName("  TALLA   calzado ")).toBe("talla calzado")
    expect(normalizeProductAttributeName("Tállá calzado")).toBe("talla calzado")
  })

  it("replaces an existing attribute instead of duplicating it", () => {
    const rows = [{
      id: "attr-1",
      name: "Tállá",
      type: "text" as const,
      isRequired: false,
      options: "",
      sortOrder: 4,
    }]

    const result = mergeProductAttribute(rows, {
      name: "Talla",
      type: "select",
      isRequired: true,
      options: "S, M, L",
      sortOrder: 0,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: "attr-1", name: "Talla", type: "select", isRequired: true, sortOrder: 4 })
  })
})

describe("setPreferredSupplier", () => {
  const rows: SupplierRow[] = [
    { id: "1", supplierId: "sup-1", supplierName: "A", unitPrice: "", isPreferred: true, notes: "" },
    { id: "2", supplierId: "sup-2", supplierName: "B", unitPrice: "", isPreferred: false, notes: "" },
  ]

  it("unchecks every other row when marking one as preferred", () => {
    const result = setPreferredSupplier(rows, 1, true)
    expect(result.map((r) => r.isPreferred)).toEqual([false, true])
  })

  it("allows unchecking the only preferred row, leaving none preferred", () => {
    const result = setPreferredSupplier(rows, 0, false)
    expect(result.map((r) => r.isPreferred)).toEqual([false, false])
  })
})
