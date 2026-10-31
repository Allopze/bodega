import { describe, expect, it } from "vitest"
import { FUEL_PATHS, fuelInboxHref, fuelInboxRef } from "./routes"

describe("fuelInboxHref", () => {
  it("sin opciones lleva a la bandeja", () => {
    expect(fuelInboxHref()).toBe(FUEL_PATHS.revisar)
  })

  it("conserva el orden de los parámetros de siempre: tipo, faena, ítem", () => {
    expect(fuelInboxHref({ tipo: "carga", item: "carga:el-1" })).toBe(`${FUEL_PATHS.revisar}?tipo=carga&item=carga%3Ael-1`)
    expect(fuelInboxHref({ tipo: "carga", faena: "ws-1" })).toBe(`${FUEL_PATHS.revisar}?tipo=carga&faena=ws-1`)
    expect(fuelInboxHref({ tipo: "patente" })).toBe(`${FUEL_PATHS.revisar}?tipo=patente`)
  })

  it("lleva el estado de los casos", () => {
    expect(fuelInboxHref({ tipo: "caso", estado: "in_review" })).toBe(`${FUEL_PATHS.revisar}?tipo=caso&estado=in_review`)
  })

  it("lleva «los casos de esta carga» como fuente:id, con el id codificado", () => {
    expect(fuelInboxHref({ tipo: "caso", ref: fuelInboxRef("tae_pwa", "abc123") })).toBe(`${FUEL_PATHS.revisar}?tipo=caso&ref=tae_pwa%3Aabc123`)
    expect(fuelInboxHref({ tipo: "caso", ref: fuelInboxRef("operation_manual", "a:b") })).toBe(`${FUEL_PATHS.revisar}?tipo=caso&ref=operation_manual%3Aa%3Ab`)
  })

  it("el `ref` se lee de vuelta tal como la bandeja lo parte: la fuente y el resto es el id", () => {
    const href = fuelInboxHref({ tipo: "caso", ref: fuelInboxRef("invoiced", "fuel:load:9") })
    const ref = new URL(href, "http://localhost").searchParams.get("ref") ?? ""
    const [source, ...idParts] = ref.split(":")
    expect(source).toBe("invoiced")
    expect(idParts.join(":")).toBe("fuel:load:9")
  })
})
