import { describe, expect, it } from "vitest"
import { formatGpsMeter, headingLabel, movementLabel } from "./fleet-gps-format"

describe("formatGpsMeter", () => {
  it("prefiere el odómetro, luego el horómetro", () => {
    expect(formatGpsMeter({ odometer: 220784.4, hourMeter: 12 })).toBe("220.784 km")
    expect(formatGpsMeter({ odometer: null, hourMeter: 1234.6 })).toBe("1.235 h")
    expect(formatGpsMeter({ odometer: null, hourMeter: null })).toBe("Sin medidor")
  })
})

describe("headingLabel / movementLabel", () => {
  it("convierte el rumbo en punto cardinal, también fuera de 0–360", () => {
    expect(headingLabel(0)).toBe("norte")
    expect(headingLabel(90)).toBe("este")
    expect(headingLabel(200)).toBe("sur")
    expect(headingLabel(337.6)).toBe("norte")
    expect(headingLabel(-90)).toBe("oeste")
  })

  it("detenido sin velocidad; con velocidad, km/h y rumbo", () => {
    expect(movementLabel({ speedKph: 0.4, headingDegrees: 90 })).toBe("Detenido")
    expect(movementLabel({ speedKph: 54.2, headingDegrees: 90 })).toBe("En movimiento · 54 km/h hacia el este")
  })
})
