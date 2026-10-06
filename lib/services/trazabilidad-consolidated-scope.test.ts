import { describe, expect, it } from "vitest"
import { resolveTraceabilityScope, TRACEABILITY_ALL_WORKSITES } from "./trazabilidad-consolidated-scope"

describe("resolveTraceabilityScope", () => {
  const several = ["ws-a", "ws-b", "ws-c"]

  it("abre en todas las faenas cuando la URL no trae faena y hay más de una visible", () => {
    expect(resolveTraceabilityScope("", several)).toBe(TRACEABILITY_ALL_WORKSITES)
  })

  it("respeta una faena visible pedida en la URL", () => {
    expect(resolveTraceabilityScope("ws-b", several)).toBe("ws-b")
  })

  it("una faena fuera del alcance cae en todas, no en la faena ajena", () => {
    expect(resolveTraceabilityScope("ws-ajena", several)).toBe(TRACEABILITY_ALL_WORKSITES)
  })

  it("'todas' explícito equivale al valor por defecto", () => {
    expect(resolveTraceabilityScope(TRACEABILITY_ALL_WORKSITES, several)).toBe(TRACEABILITY_ALL_WORKSITES)
  })

  it("quien ve una sola faena conserva esa faena, incluso si pide 'todas'", () => {
    expect(resolveTraceabilityScope("", ["ws-a"])).toBe("ws-a")
    expect(resolveTraceabilityScope(TRACEABILITY_ALL_WORKSITES, ["ws-a"])).toBe("ws-a")
  })

  it("sin faenas visibles no hay alcance", () => {
    expect(resolveTraceabilityScope("ws-a", [])).toBe("")
  })
})
