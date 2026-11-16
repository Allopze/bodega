import { describe, expect, it } from "vitest"
import { filterGpsPositions, formatGpsMeter, headingLabel, movementLabel } from "./fleet-gps-format"

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

describe("filterGpsPositions", () => {
  const base = { brand: "Volvo", model: "FH", typeName: "Camión", worksiteName: "Pacifico", providers: ["OnWay"] }
  const rows = [{ ...base, plate: "AB1234", code: "KA-1" }, { ...base, plate: "CD5678", code: "GR-2", worksiteName: "Santa Fe", providers: ["Wialon"] }]

  it("sin búsqueda devuelve todo; con búsqueda, por patente, código, faena o fuente, sin distinguir mayúsculas", () => {
    expect(filterGpsPositions(rows, "  ")).toHaveLength(2)
    expect(filterGpsPositions(rows, "ka-1").map((row) => row.plate)).toEqual(["AB1234"])
    expect(filterGpsPositions(rows, "santa").map((row) => row.plate)).toEqual(["CD5678"])
    expect(filterGpsPositions(rows, "wialon").map((row) => row.plate)).toEqual(["CD5678"])
  })
})
