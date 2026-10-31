import { describe, expect, it } from "vitest"
import { buildConsumptionHref, buildLitrosHref } from "./consumption-url"

describe("buildConsumptionHref", () => {
  it("sin pathname apunta a Cargas › Tarjetas, no al Panel", () => {
    expect(buildConsumptionHref("desde=2026-06-01", { patente: "ABCD12" })).toBe("/combustibles/cargas/tarjetas?desde=2026-06-01&patente=ABCD12")
  })

  it("resets pagination when filters change", () => {
    expect(buildConsumptionHref(
      "desde=2026-06-01&hasta=2026-06-30&page=3",
      { patente: "ABCD12" },
    )).toBe("/combustibles/cargas/tarjetas?desde=2026-06-01&hasta=2026-06-30&patente=ABCD12")
  })

  it("keeps pagination when moving between pages", () => {
    expect(buildConsumptionHref(
      "desde=2026-06-01&hasta=2026-06-30&page=3",
      { page: "4" },
      { resetPage: false },
    )).toBe("/combustibles/cargas/tarjetas?desde=2026-06-01&hasta=2026-06-30&page=4")
  })

  it("removes empty filters", () => {
    expect(buildConsumptionHref("patente=ABCD12&faena=f1", { patente: "" })).toBe("/combustibles/cargas/tarjetas?faena=f1")
  })

  it("una pantalla puede pedir su propio camino", () => {
    expect(buildConsumptionHref("periodo=2026-10", { proveedor: "Copec" }, { pathname: "/combustibles/consumo/litros" })).toBe("/combustibles/consumo/litros?periodo=2026-10&proveedor=Copec")
  })
})

describe("buildLitrosHref", () => {
  it("un filtro de tarjetas abre el análisis de tarjetas y conserva el período y la faena", () => {
    expect(buildLitrosHref("periodo=2026-10&faena=f1", { patente: "ABCD12" })).toBe("/combustibles/consumo/litros?periodo=2026-10&faena=f1&seccion=tarjetas&patente=ABCD12")
  })

  it("quitar un filtro no cierra la sección", () => {
    expect(buildLitrosHref("periodo=2026-10&seccion=tarjetas&patente=ABCD12", { patente: "" })).toBe("/combustibles/consumo/litros?periodo=2026-10&seccion=tarjetas")
  })

  it("la sección también puede pedirse sola, o cambiarse", () => {
    expect(buildLitrosHref("periodo=2026-10", {}, { section: "planilla" })).toBe("/combustibles/consumo/litros?periodo=2026-10&seccion=planilla")
    expect(buildLitrosHref("periodo=2026-10&seccion=tarjetas", { seccion: null })).toBe("/combustibles/consumo/litros?periodo=2026-10")
  })

  it("no arrastra la página de ninguna tabla", () => {
    expect(buildLitrosHref("periodo=2026-10&page=4", { proveedor: "Copec" }, { section: "planilla" })).toBe("/combustibles/consumo/litros?periodo=2026-10&seccion=planilla&proveedor=Copec")
  })
})
