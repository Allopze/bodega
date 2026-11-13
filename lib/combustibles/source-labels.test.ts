import { describe, expect, it } from "vitest"
import { fuelRecordSourceLabel } from "./source-labels"

describe("fuelRecordSourceLabel", () => {
  it("traduce las fuentes de Copec sin siglas", () => {
    expect(fuelRecordSourceLabel("Copec TCT Diesel")).toBe("Tarjeta Copec de equipos · Diésel")
    expect(fuelRecordSourceLabel("Copec TCT BlueMax")).toBe("Tarjeta Copec de equipos · BlueMax")
    expect(fuelRecordSourceLabel("Copec TAE")).toBe("Abastecimiento de estanques")
  })

  it("traduce Aramco y deja una fuente manual tal cual", () => {
    expect(fuelRecordSourceLabel("Aramco Fleet Diesel")).toBe("Tarjeta Aramco · Diésel")
    expect(fuelRecordSourceLabel("Planilla consolidado octubre")).toBe("Planilla consolidado octubre")
  })

  it("sin fuente muestra un guion", () => {
    expect(fuelRecordSourceLabel(null)).toBe("—")
    expect(fuelRecordSourceLabel("  ")).toBe("—")
  })
})
