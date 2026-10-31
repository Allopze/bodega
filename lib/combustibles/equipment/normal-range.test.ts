import { describe, expect, it } from "vitest"
import { computeNormalRange, isOutOfRange, outOfRangeRun, regularityOf } from "./normal-range"

describe("rango normal de un equipo", () => {
  const history = [11, 12, 12, 13, 12, 12]

  it("es su promedio ± k desviaciones estándar muestrales", () => {
    const range = computeNormalRange(history, 2, 5)!
    expect(range.mean).toBe(12)
    expect(range.samples).toBe(6)
    expect(range.sd).toBeCloseTo(Math.sqrt(2 / 5), 6)
    expect(range.low).toBeCloseTo(12 - 2 * Math.sqrt(0.4), 6)
    expect(range.high).toBeCloseTo(12 + 2 * Math.sqrt(0.4), 6)
  })

  it("con menos cargas que el mínimo no inventa una franja", () => {
    expect(computeNormalRange([11, 12, 13, 12], 2, 5)).toBeNull()
    expect(computeNormalRange([12], 2, 1)).toBeNull()
    expect(computeNormalRange([], 2, 5)).toBeNull()
  })

  it("km/L es malo por debajo del rango y L/h, por encima", () => {
    const range = { low: 2.5, high: 3.1 }
    expect(isOutOfRange("km_per_liter", 2.2, range)).toBe(true)
    expect(isOutOfRange("km_per_liter", 3.5, range)).toBe(false)
    expect(isOutOfRange("liters_per_hour", 3.5, range)).toBe(true)
    expect(isOutOfRange("liters_per_hour", 2.2, range)).toBe(false)
    expect(isOutOfRange("km_per_liter", 2.5, range)).toBe(false)
  })
})

describe("desde cuándo rinde fuera de su rango", () => {
  const point = (at: string, outOfRange: boolean) => ({ occurredAt: at, outOfRange })

  it("es la racha de puntos fuera de rango que llega hasta la última carga", () => {
    const run = outOfRangeRun([point("2026-10-01", false), point("2026-10-10", true), point("2026-10-18", true), point("2026-10-25", true)])
    expect(run).toEqual({ at: "2026-10-10", count: 3 })
  })

  it("si la última carga está dentro del rango no hay racha, aunque hubo una mala antes", () => {
    expect(outOfRangeRun([point("2026-10-01", true), point("2026-10-10", false)])).toBeNull()
  })

  it("sin puntos no hay racha", () => {
    expect(outOfRangeRun([])).toBeNull()
  })
})

describe("parejo o irregular", () => {
  it("sobre 25 % de variación es irregular; hasta 25 %, parejo", () => {
    expect(regularityOf(10, 2.5)).toEqual({ regularity: "parejo", cv: 0.25 })
    expect(regularityOf(10, 2.6).regularity).toBe("irregular")
    expect(regularityOf(10, 0.5).regularity).toBe("parejo")
  })

  it("sin desviación o sin promedio no se puede decir", () => {
    expect(regularityOf(10, null)).toEqual({ regularity: null, cv: null })
    expect(regularityOf(null, 1)).toEqual({ regularity: null, cv: null })
    expect(regularityOf(0, 1)).toEqual({ regularity: null, cv: null })
  })
})
