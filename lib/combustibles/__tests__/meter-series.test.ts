import { describe, expect, it } from "vitest"
import { elapsedDays, maxMeterRatePerDayOf, meterSeriesAdvance, type MeterSeriesPoint } from "../meter-series"

/**
 * El recorrido de un equipo en una ventana (Flota) se calcula con las mismas
 * reglas con que el detector de anomalías objeta una lectura: retroceso y salto
 * imposible para los días transcurridos. Estas pruebas fijan que un retroceso sin
 * reset aceptado jamás se suma, que un reset aceptado parte la serie sin avisar de
 * error y que el resultado no puede ser negativo ni superar la cota física.
 */

const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}T12:00:00.000Z`
const at = (value: number, dayOfMonth: number, acceptedReset = false): MeterSeriesPoint => ({ value, occurredAt: day(dayOfMonth), acceptedReset })
const KM_CEILING = 1_500

describe("meterSeriesAdvance · serie limpia", () => {
  it("suma los avances entre lecturas consecutivas (igual a última menos primera)", () => {
    expect(meterSeriesAdvance([at(10_000, 1), at(10_400, 3), at(11_000, 6)], KM_CEILING)).toEqual({ advance: 1_000, discardedPairs: 0 })
  })

  it("sin lecturas, o con una sola, no hay recorrido que calcular", () => {
    expect(meterSeriesAdvance([], KM_CEILING)).toEqual({ advance: null, discardedPairs: 0 })
    expect(meterSeriesAdvance([at(10_000, 1)], KM_CEILING)).toEqual({ advance: null, discardedPairs: 0 })
  })

  it("un equipo que no se movió avanza 0, no es un recorrido desconocido", () => {
    expect(meterSeriesAdvance([at(10_000, 1), at(10_000, 4)], KM_CEILING)).toEqual({ advance: 0, discardedPairs: 0 })
  })
})

describe("meterSeriesAdvance · retroceso sin reset aceptado", () => {
  it("no suma el retroceso ni el salto de regreso: un error de tipeo no entra a la cuenta", () => {
    // 10.300 → 1.030 (se perdió un dígito) → 10.600: ni el −9.270 ni el +9.570 son recorrido.
    const result = meterSeriesAdvance([at(10_000, 1), at(10_300, 3), at(1_030, 5), at(10_600, 8), at(10_900, 10)], KM_CEILING)

    expect(result.advance).toBe(600)
    expect(result.discardedPairs).toBe(2)
  })

  it("la lectura que retrocede no sirve de base para la siguiente aunque el avance parezca razonable", () => {
    // 29.162 → 1 → 29.264: el último par (+29.263 en 62 días = 472 km/día) cabe bajo la cota, pero parte de una lectura objetada.
    const result = meterSeriesAdvance([
      { value: 29_098, occurredAt: "2026-01-29T21:37:00.000Z" },
      { value: 29_162, occurredAt: "2026-05-05T17:33:00.000Z" },
      { value: 1, occurredAt: "2026-06-03T16:55:00.000Z" },
      { value: 29_264, occurredAt: "2026-08-05T19:54:00.000Z" },
      { value: 29_461, occurredAt: "2026-08-12T22:36:00.000Z" },
    ], KM_CEILING)

    expect(result.advance).toBe(64 + 197)
    expect(result.discardedPairs).toBe(2)
  })

  it("si toda la serie retrocede no hay recorrido calculable, nunca un valor negativo", () => {
    const result = meterSeriesAdvance([at(300_000, 1), at(40_615, 5)], KM_CEILING)

    expect(result).toEqual({ advance: null, discardedPairs: 1 })
  })
})

describe("meterSeriesAdvance · reset aceptado", () => {
  it("parte la serie en la lectura del reset: no suma el retroceso y no lo cuenta como par descartado", () => {
    const result = meterSeriesAdvance([at(10_000, 1), at(10_400, 3), at(1_000, 5, true), at(1_300, 8), at(1_500, 10)], KM_CEILING)

    // 400 antes del reset + 300 + 200 después; el tramo 10.400 → 1.000 es desconocido.
    expect(result).toEqual({ advance: 900, discardedPairs: 0 })
  })

  it("un reset aceptado no tapa un retroceso posterior sin aceptar", () => {
    const result = meterSeriesAdvance([at(10_000, 1), at(1_000, 3, true), at(1_400, 5), at(300, 7), at(700, 9), at(1_000, 11)], KM_CEILING)

    // 400 + (1.400 → 300 objetado) + (300 → 700 sin base) + 300.
    expect(result).toEqual({ advance: 700, discardedPairs: 2 })
  })

  it("un reset aceptado justo después de una lectura objetada vuelve a fiar de la serie", () => {
    const result = meterSeriesAdvance([at(1_000, 1), at(500, 3), at(100, 5, true), at(200, 7)], KM_CEILING)

    expect(result).toEqual({ advance: 100, discardedPairs: 1 })
  })

  it("la primera lectura de la serie no tiene par: marcarla como reset no cambia nada", () => {
    expect(meterSeriesAdvance([at(1_000, 1, true), at(1_300, 3)], KM_CEILING)).toEqual({ advance: 300, discardedPairs: 0 })
  })
})

describe("meterSeriesAdvance · salto imposible", () => {
  it("un dígito de más (100.000 como 1.000.000) no infla el recorrido", () => {
    const result = meterSeriesAdvance([at(100_000, 1), at(100_200, 3), at(1_000_000, 5), at(100_500, 7), at(100_800, 9)], KM_CEILING)

    expect(result.advance).toBe(200 + 300)
    expect(result.discardedPairs).toBe(2)
  })

  it("la cota es por día: 1.400 km en el mismo día caben, 1.600 no", () => {
    expect(meterSeriesAdvance([at(1_000, 1), at(2_400, 1)], KM_CEILING)).toEqual({ advance: 1_400, discardedPairs: 0 })
    expect(meterSeriesAdvance([at(1_000, 1), at(2_600, 1)], KM_CEILING)).toEqual({ advance: null, discardedPairs: 1 })
  })

  it("con horómetro la cota es de 24 horas por día", () => {
    expect(meterSeriesAdvance([at(100, 1), at(124, 2)], 24)).toEqual({ advance: 24, discardedPairs: 0 })
    expect(meterSeriesAdvance([at(100, 1), at(130, 2)], 24)).toEqual({ advance: null, discardedPairs: 1 })
  })
})

describe("elapsedDays", () => {
  it("cuenta días calendario con piso de 1: dos lecturas del mismo día no dividen por cero", () => {
    expect(elapsedDays(day(1), day(1))).toBe(1)
    expect(elapsedDays(day(1), day(4))).toBe(3)
    expect(elapsedDays("no-es-fecha", day(4))).toBe(1)
  })
})

describe("maxMeterRatePerDayOf", () => {
  it("sin configuración usa las cotas físicas: 1.500 km y 24 h por día", () => {
    expect(maxMeterRatePerDayOf({ config: null }, "km")).toBe(1_500)
    expect(maxMeterRatePerDayOf({ config: "{}" }, "hora")).toBe(24)
    expect(maxMeterRatePerDayOf({ config: "no es json" }, "km")).toBe(1_500)
  })

  it("respeta la regla `salto_medidor_implausible` y el override por tipo de equipo", () => {
    const rule = { config: JSON.stringify({ maxKmPerDay: 900, maxHoursPerDay: 20, equipmentTypes: { grua: { maxKmPerDay: 300 } } }) }

    expect(maxMeterRatePerDayOf(rule, "km")).toBe(900)
    expect(maxMeterRatePerDayOf(rule, "hora")).toBe(20)
    expect(maxMeterRatePerDayOf(rule, "km", "grua")).toBe(300)
    expect(maxMeterRatePerDayOf(rule, "km", "camion")).toBe(900)
  })
})
