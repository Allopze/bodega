import { describe, it, expect } from "vitest"
import { CLP_ROUNDING_TOLERANCE, AUTO_LINK_CLP_TOLERANCE } from "./money-tolerance"

describe("tolerancias de dinero del conciliador", () => {
  it("acepta un peso de redondeo y nada más", () => {
    expect(CLP_ROUNDING_TOLERANCE).toBe(1)
  })

  it("nunca vincula solo con más holgura de la que aceptaría la conciliación", () => {
    // El vínculo automático no pasa por una persona: aflojarlo por encima de lo
    // que la conciliación considera "calza" ataría facturas a compras ajenas
    // sin que nadie lo mire. La conciliación puede aflojarse; ésta no la sigue.
    expect(AUTO_LINK_CLP_TOLERANCE).toBeLessThanOrEqual(CLP_ROUNDING_TOLERANCE)
  })
})
