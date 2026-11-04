import { describe, expect, it } from "vitest"
import {
  MIN_RATE_SEGMENTS,
  buildMeterRateSeries,
  describeMeterRate,
  isPartialMonth,
  type RateReading,
  type RateVehicle,
} from "../meter-rate-series"

/**
 * CHART-016: km/L o L/h por mes, derivado de las lecturas de medidor del detalle de Copec.
 *
 * Un mes se arma con los pares de lecturas consecutivas que **cierra** (el avance de un par se atribuye al
 * mes de su lectura final), con los litros de esa misma carga. El rendimiento es la razón de las sumas, no el
 * promedio de las razones, y un par que el detector de anomalías objetaría no entra a ninguna de las dos.
 */

const LIMITS = { maxKmPerLiter: 25, maxLitersPerHour: 80 }
const KM_CEILING = 1_500
const HOUR_CEILING = 24

const at = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}T15:00:00.000Z`
const reading = (value: number, month: string, day: number, liters: number | null, acceptedReset = false): RateReading => ({
  value, occurredAt: at(month, day), liters, acceptedReset,
})
const km = (readings: RateReading[], vehicleId = "v1"): RateVehicle => ({ vehicleId, unit: "km_per_liter", maxPerDay: KM_CEILING, readings })
const hours = (readings: RateReading[], vehicleId = "h1"): RateVehicle => ({ vehicleId, unit: "liters_per_hour", maxPerDay: HOUR_CEILING, readings })

const build = (vehicles: RateVehicle[], monthKeys: string[], extra: Partial<Parameters<typeof buildMeterRateSeries>[0]> = {}) =>
  buildMeterRateSeries({ vehicles, monthKeys, gapMonths: new Set(), limits: LIMITS, ...extra })

/** Cuatro cargas de ~100 km y 40 L en marzo: tres pares sumados (la primera lectura sólo abre). */
const MARCH_KM = [
  reading(10_000, "2026-03", 1, 40),
  reading(10_100, "2026-03", 5, 40),
  reading(10_200, "2026-03", 10, 40),
  reading(10_300, "2026-03", 15, 40),
]

describe("buildMeterRateSeries · km/L", () => {
  it("el rendimiento del mes es Σkm ÷ ΣL, no el promedio de las razones de cada tramo", () => {
    // 100 km con 10 L (10 km/L), 100 km con 50 L (2 km/L) y 100 km con 40 L (2,5 km/L): la razón de sumas es 300/100 = 3 km/L
    // y el promedio de las razones sería 4,83 km/L.
    const series = build([km([
      reading(10_000, "2026-03", 1, 40),
      reading(10_100, "2026-03", 5, 10),
      reading(10_200, "2026-03", 10, 50),
      reading(10_300, "2026-03", 15, 40),
    ])], ["2026-03"])

    const march = series.km_per_liter.months[0]!
    expect(march).toMatchObject({ month: "2026-03", measure: 300, liters: 100, segments: 3, equipment: 1, discarded: 0, status: "ok", partial: false })
    expect(march.rate).toBeCloseTo(3, 10)
    expect(series.km_per_liter.rate).toBeCloseTo(3, 10)
  })

  it("el avance de un par se atribuye al mes de su lectura final, y la lectura del mes previo sólo hace de base", () => {
    const series = build([km([
      reading(9_900, "2026-02", 27, 40), // base: fuera de la ventana
      reading(10_000, "2026-03", 2, 40),
      reading(10_100, "2026-03", 8, 40),
      reading(10_200, "2026-03", 14, 40),
    ])], ["2026-03"])

    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 3, measure: 300, liters: 120 })
    // Las lecturas dentro de la ventana son 3; la de febrero no cuenta como lectura del gráfico.
    expect(series.km_per_liter.readings).toBe(3)
  })

  it("un par que el detector objetaría no se suma, y se cuenta aparte", () => {
    // 10.300 → 1.030 (se perdió un dígito): ni el retroceso ni el salto de vuelta son recorrido.
    const series = build([km([
      reading(10_000, "2026-03", 1, 40),
      reading(10_100, "2026-03", 4, 40),
      reading(10_200, "2026-03", 7, 40),
      reading(10_300, "2026-03", 10, 40),
      reading(1_030, "2026-03", 13, 40),
      reading(10_600, "2026-03", 16, 40),
      reading(10_700, "2026-03", 19, 40),
    ])], ["2026-03"])

    const march = series.km_per_liter.months[0]!
    expect(march).toMatchObject({ measure: 400, liters: 160, segments: 4, discarded: 2 })
    expect(march.rate).toBeCloseTo(2.5, 10)
  })

  it("un reset aceptado parte la serie sin contar como par descartado", () => {
    const series = build([km([
      ...MARCH_KM,
      reading(500, "2026-03", 20, 40, true),
      reading(600, "2026-03", 25, 40),
    ])], ["2026-03"])

    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 4, measure: 400, discarded: 0 })
  })

  it("con menos tramos que el mínimo no hay rendimiento: «datos insuficientes», pero las cifras del mes siguen a la vista", () => {
    const series = build([km(MARCH_KM.slice(0, 3))], ["2026-03"])

    expect(MIN_RATE_SEGMENTS).toBe(3)
    const march = series.km_per_liter.months[0]!
    expect(march).toMatchObject({ segments: 2, measure: 200, liters: 80, status: "insufficient", rate: null })
    expect(series.km_per_liter.status).toBe("insufficient")
    expect(series.km_per_liter.rate).toBeNull()
  })

  it("un mes sin datos del proveedor es un hueco, no una caída a cero", () => {
    const series = build([km(MARCH_KM)], ["2026-03", "2026-04"], { gapMonths: new Set(["2026-04"]) })

    expect(series.km_per_liter.months.map((month) => [month.month, month.status, month.rate === null])).toEqual([
      ["2026-03", "ok", false],
      ["2026-04", "gap", true],
    ])
    // El hueco no suma ceros al global.
    expect(series.km_per_liter.measure).toBe(300)
  })

  it("un par que cruza un mes sin datos se descarta: el kilometraje de dos meses no se divide por los litros de una carga", () => {
    const series = build([km([
      reading(10_000, "2026-03", 28, 40),
      reading(10_100, "2026-03", 30, 40),
      reading(10_200, "2026-03", 31, 40),
      // Abril sin transacciones del proveedor: el par marzo → mayo recorre dos meses con los litros de una sola carga.
      reading(12_700, "2026-05", 3, 40),
      reading(12_800, "2026-05", 6, 40),
      reading(12_900, "2026-05", 9, 40),
      reading(13_000, "2026-05", 12, 40),
    ])], ["2026-03", "2026-04", "2026-05"], { gapMonths: new Set(["2026-04"]) })

    const [march, , may] = series.km_per_liter.months
    expect(march).toMatchObject({ segments: 2, measure: 200 })
    expect(may).toMatchObject({ segments: 3, measure: 300, discarded: 1, status: "ok" })
    expect(may!.rate).toBeCloseTo(2.5, 10)
  })

  it("descarta el par sin litros y el de rendimiento físicamente imposible, y no los deja en la razón", () => {
    const series = build([km([
      reading(10_000, "2026-03", 1, 40),
      reading(10_100, "2026-03", 4, null), // sin litros: no hay con qué dividir
      reading(10_200, "2026-03", 7, 40),
      reading(10_800, "2026-03", 10, 2), // 600 km con 2 L = 300 km/L (carga parcial o lectura mal tipeada)
      reading(10_900, "2026-03", 13, 40),
      reading(11_000, "2026-03", 16, 40),
      reading(11_100, "2026-03", 19, 40),
    ])], ["2026-03"])

    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 4, measure: 400, liters: 160, discarded: 2 })
  })

  it("un par sin avance (el medidor no se movió) no es un rendimiento de 0 km/L: se descarta", () => {
    const series = build([km([
      reading(10_000, "2026-03", 1, 40),
      reading(10_000, "2026-03", 4, 40),
      reading(10_100, "2026-03", 7, 40),
      reading(10_200, "2026-03", 10, 40),
      reading(10_300, "2026-03", 13, 40),
    ])], ["2026-03"])

    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 3, discarded: 1 })
  })

  it("con una fecha de inicio a mitad de mes, los pares que cierran antes de ella no entran (el período no empieza el día 1)", () => {
    const series = build([km([
      reading(10_000, "2026-03", 1, 40),
      reading(10_100, "2026-03", 5, 40),
      reading(10_200, "2026-03", 10, 40),
      reading(10_300, "2026-03", 15, 40),
      reading(10_400, "2026-03", 20, 40),
      reading(10_500, "2026-03", 25, 40),
    ])], ["2026-03"], { fromDate: "2026-03-15" })

    // Desde el 15: los pares que cierran el 15, 20 y 25. El del 10 y los anteriores quedan fuera; la lectura del 10 sólo hace de base.
    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 3, measure: 300, liters: 120 })
    expect(series.km_per_liter.readings).toBe(3)
  })

  it("el mes en curso se marca como parcial", () => {
    const series = build([km(MARCH_KM)], ["2026-02", "2026-03"], { partialMonth: "2026-03" })

    expect(series.km_per_liter.months.map((month) => month.partial)).toEqual([false, true])
  })

  it("cuenta los equipos que aportan al mes, y cada equipo con su propia serie", () => {
    const series = build([
      km(MARCH_KM, "v1"),
      km(MARCH_KM.map((point) => ({ ...point, value: point.value + 50_000 })), "v2"),
    ], ["2026-03"])

    expect(series.km_per_liter.months[0]).toMatchObject({ segments: 6, equipment: 2, measure: 600 })
    expect(series.km_per_liter.equipment).toBe(2)
  })

  it("sin ninguna lectura en la ventana la serie está vacía; con lecturas y sin pares sirvió, es insuficiente", () => {
    expect(build([], ["2026-03"]).km_per_liter.status).toBe("empty")
    expect(build([km([reading(10_000, "2026-03", 1, 40)])], ["2026-03"]).km_per_liter.status).toBe("insufficient")
  })

  it("los equipos de horómetro no se mezclan con los de odómetro", () => {
    const series = build([km(MARCH_KM), hours([reading(100, "2026-03", 1, 50), reading(108, "2026-03", 3, 80)])], ["2026-03"])

    expect(series.km_per_liter.segments).toBe(3)
    expect(series.liters_per_hour.segments).toBe(1)
  })
})

describe("buildMeterRateSeries · L/h", () => {
  it("el rendimiento es ΣL ÷ Σh y se descarta el que supera la cota física de L/h", () => {
    const series = build([hours([
      reading(100, "2026-03", 1, 50),
      reading(108, "2026-03", 3, 80), // 10 L/h
      reading(116, "2026-03", 5, 120), // 15 L/h
      reading(124, "2026-03", 7, 160), // 20 L/h
      reading(125, "2026-03", 8, 400), // 400 L/h: imposible
    ])], ["2026-03"])

    const march = series.liters_per_hour.months[0]!
    expect(march).toMatchObject({ measure: 24, liters: 360, segments: 3, discarded: 1, status: "ok" })
    expect(march.rate).toBeCloseTo(15, 10)
  })
})

describe("describeMeterRate", () => {
  const fullMonths = (rates: Array<[string, number | null, Partial<{ partial: boolean; status: "ok" | "insufficient" | "gap"; segments: number }>?]>) =>
    rates.map(([month, rate, extra]) => ({
      month, rate, measure: 100, liters: 40, segments: extra?.segments ?? (rate === null ? 0 : 5), equipment: 2, discarded: 0,
      status: extra?.status ?? (rate === null ? "gap" : "ok"), partial: extra?.partial ?? false,
    }) as const)

  const series = (months: ReturnType<typeof fullMonths>, extra: Partial<{ rate: number | null; segments: number; equipment: number; status: "ok" | "insufficient" | "empty" }> = {}) => ({
    unit: "km_per_liter" as const, months, rate: 3, measure: 300, liters: 100, segments: 15, equipment: 2, discarded: 0, readings: 20, status: "ok" as const, ...extra,
  })

  it("dice el global, de cuántos tramos y equipos sale, y cómo fue el último mes con datos contra ese global", () => {
    const text = describeMeterRate(series(fullMonths([["2026-08", 3], ["2026-09", null], ["2026-10", 3.3]])))

    expect(text).toContain("3 km/L")
    expect(text).toContain("15 tramos")
    expect(text).toContain("2 equipos")
    expect(text).toContain("octubre")
    expect(text).toContain("10 % más que el global")
  })

  it("si el último mes con datos es el mes en curso, lo dice: no lo presenta como un mes cerrado", () => {
    const text = describeMeterRate(series(fullMonths([["2026-09", 3], ["2026-10", 2.4, { partial: true }]])))

    expect(text).toMatch(/octubre \(en curso\)/)
    expect(text).toContain("20 % menos que el global")
  })

  it("un mes con datos insuficientes no hace de «último mes»", () => {
    const text = describeMeterRate(series(fullMonths([["2026-09", 3], ["2026-10", null, { status: "insufficient", segments: 1 }]])))

    expect(text).toContain("septiembre")
    expect(text).not.toContain("octubre")
  })

  it("sin rendimiento global dice «datos insuficientes» y cuántos tramos hay, sin inventar una cifra", () => {
    const text = describeMeterRate(series(fullMonths([["2026-10", null, { status: "insufficient", segments: 2 }]]), { rate: null, segments: 2, status: "insufficient" }))

    expect(text).toMatch(/datos insuficientes/i)
    expect(text).toContain("2 tramos")
    expect(text).not.toContain("km/L")
  })

  it("con un solo equipo habla en singular", () => {
    const text = describeMeterRate(series(fullMonths([["2026-10", 3]]), { equipment: 1, segments: 1 }))

    expect(text).toContain("1 tramo ")
    expect(text).toContain("1 equipo.")
  })
})

describe("isPartialMonth", () => {
  it("el mes del corte es parcial si el corte cae antes de su último día", () => {
    expect(isPartialMonth("2026-10", "2026-10-31", "2026-11-03")).toBe(false)
    expect(isPartialMonth("2026-10", "2026-10-20", "2026-11-03")).toBe(true)
    // El período llega hasta fin de mes, pero hoy es 10 de octubre: octubre no ha terminado.
    expect(isPartialMonth("2026-10", "2026-10-31", "2026-10-10")).toBe(true)
  })

  it("sólo el último mes de la ventana puede ser parcial", () => {
    expect(isPartialMonth("2026-09", "2026-10-20", "2026-11-03")).toBe(false)
  })
})
