import { describe, expect, it } from "vitest"
import { normalizeUnitOfMeasure, sparePartUnitMismatchMessage } from "./spare-part-unit"

describe("unidad del repuesto vs. la línea", () => {
  it("compara sin caja ni espacios en los bordes", () => {
    expect(normalizeUnitOfMeasure("  Juego ")).toBe("juego")
    expect(normalizeUnitOfMeasure(null)).toBe("")
    expect(sparePartUnitMismatchMessage({ sku: "RPT-012", unitOfMeasure: "unidad" }, " UNIDAD")).toBeNull()
  })

  it("explica la diferencia con el SKU y las dos unidades", () => {
    expect(sparePartUnitMismatchMessage({ sku: "RPT-012", unitOfMeasure: "unidad" }, "juego")).toBe(
      "El repuesto RPT-012 se compra por «unidad» y la línea pide «juego»; elige otro o crea uno nuevo",
    )
  })
})
