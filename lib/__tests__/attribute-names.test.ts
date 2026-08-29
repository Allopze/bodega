import { describe, expect, it } from "vitest"
import { normalizeAttributeName, duplicateNormalizedNames } from "@/lib/products/attribute-names"

describe("normalizeAttributeName", () => {
  it("colapsa tildes, caja y espacios", () => {
    expect(normalizeAttributeName("  TÁLLÁ   calzado ")).toBe("talla calzado")
    expect(normalizeAttributeName("Talla")).toBe("talla")
  })
  it("detecta el repetido que el lote dejaba pasar", () => {
    expect(duplicateNormalizedNames(["Tállá", "Talla"]).has("talla")).toBe(true)
  })
  it("ignora vacíos", () => {
    expect(duplicateNormalizedNames(["", "  ", "Talla"]).size).toBe(0)
  })
})
