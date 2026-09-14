import { describe, expect, it } from "vitest"
import { resolveOrderItemMatchName } from "./order-item-identity"

describe("resolveOrderItemMatchName", () => {
  it("prefiere el nombre operativo al de catálogo", () => {
    expect(resolveOrderItemMatchName({
      id: "item-1",
      productNameFree: "Insumo recibido sin factura E2E",
      productName: "Guante E2E",
    })).toBe("Insumo recibido sin factura E2E")
  })

  it("cae al nombre de catálogo cuando no hay texto libre", () => {
    expect(resolveOrderItemMatchName({ id: "item-1", productNameFree: null, productName: "Guante E2E" }))
      .toBe("Guante E2E")
  })

  // Un textarea que quedó con espacios no es un nombre; antes ganaba igual y dejaba la
  // línea sin nada comparable contra la glosa del proveedor.
  it("ignora un texto libre en blanco", () => {
    expect(resolveOrderItemMatchName({ id: "item-1", productNameFree: "   ", productName: "Guante E2E" }))
      .toBe("Guante E2E")
  })

  it("usa el id sólo cuando no hay ningún nombre", () => {
    expect(resolveOrderItemMatchName({ id: "item-1", productNameFree: null, productName: null })).toBe("item-1")
  })
})
