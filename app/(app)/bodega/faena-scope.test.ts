import { describe, expect, it } from "vitest"
import { ALL_WORKSITES, faenaScopeParam, ownVisibleWorksiteId, resolveFaena } from "./faena-scope"

const VISIBLE = [{ id: "ws-1" }, { id: "ws-2" }]

describe("ownVisibleWorksiteId (BOD-06)", () => {
  it("es la faena principal cuando está a la vista", () => {
    expect(ownVisibleWorksiteId("ws-2", VISIBLE)).toBe("ws-2")
  })

  it("sin faena principal, o fuera del alcance, la pantalla parte en Todas", () => {
    expect(ownVisibleWorksiteId(null, VISIBLE)).toBe("")
    expect(ownVisibleWorksiteId(undefined, VISIBLE)).toBe("")
    expect(ownVisibleWorksiteId("ws-cerrada", VISIBLE)).toBe("")
  })
})

describe("faenaScopeParam", () => {
  it("no escribe nada cuando la faena es la de por defecto", () => {
    expect(faenaScopeParam("ws-1", "ws-1")).toBe("")
    expect(faenaScopeParam("", "")).toBe("")
  })

  it("escribe la faena elegida y 'todas' de forma explícita", () => {
    expect(faenaScopeParam("ws-2", "ws-1")).toBe("faena=ws-2")
    expect(faenaScopeParam("", "ws-1")).toBe(`faena=${ALL_WORKSITES}`)
  })

  it("lo que escribe se lee de vuelta como la misma faena", () => {
    expect(resolveFaena(ALL_WORKSITES, "ws-1")).toBe("")
    expect(resolveFaena("ws-2", "ws-1")).toBe("ws-2")
    expect(resolveFaena("", "ws-1")).toBe("ws-1")
  })
})
