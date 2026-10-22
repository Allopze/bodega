import { describe, expect, it } from "vitest"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS, type LoadSource, type ReviewStatus } from "../contracts"
import { computeVehicleSeries, parseInstantMs, type SeriesLoad, type SeriesVehicle } from "./performance-series"

const truck: SeriesVehicle = { meterType: "odometer", performanceUnit: "km_per_liter", tankCapacityLiters: 400 }
const loader: SeriesVehicle = { meterType: "hour_meter", performanceUnit: "liters_per_hour", tankCapacityLiters: null }
const settings = { ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS }

let seq = 0
function load(partial: Partial<SeriesLoad> & { reading?: number | null; at?: string }): SeriesLoad {
  seq += 1
  const { reading, at, ...rest } = partial
  return {
    id: `L${String(seq).padStart(3, "0")}`,
    source: "field" as LoadSource,
    occurredAt: at ?? `2026-01-${String(seq % 28 + 1).padStart(2, "0")}T12:00:00.000Z`,
    liters: 100,
    meterReading: reading === undefined ? null : reading,
    meterReset: false,
    voidedAt: null,
    reviewStatus: "ok" as ReviewStatus,
    flagReasons: [],
    ...rest,
  }
}

/** Serie con días consecutivos (orden garantizado). */
function series(...items: Array<Partial<SeriesLoad> & { reading?: number | null }>): SeriesLoad[] {
  return items.map((item, i) => load({ at: `2026-03-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`, ...item }))
}

describe("computeVehicleSeries — estados de cálculo", () => {
  it("primera carga del equipo: first_load sin rendimiento", () => {
    const [first] = computeVehicleSeries(truck, series({ reading: 1000 }), settings)
    expect(first).toMatchObject({ performanceStatus: "first_load", performanceValue: null, reviewStatus: "ok", flagReasons: [] })
  })

  it("km/L = avance ÷ litros, con ancla y litros acumulados guardados", () => {
    const loads = series({ reading: 1000 }, { reading: 1500, liters: 50 })
    const [, second] = computeVehicleSeries(truck, loads, settings)
    expect(second).toMatchObject({
      performanceStatus: "computed", performanceUnit: "km_per_liter", performanceValue: 10,
      anchorLoadId: loads[0]!.id, meterDelta: 500, accumulatedLiters: 50, meterType: "odometer",
    })
  })

  it("L/h = litros ÷ horas para horómetro", () => {
    const [, second] = computeVehicleSeries(loader, series({ reading: 100 }, { reading: 110, liters: 150 }), settings)
    expect(second).toMatchObject({ performanceStatus: "computed", performanceUnit: "liters_per_hour", performanceValue: 15 })
  })

  it("acumula los litros de una carga sin lectura en el tramo siguiente", () => {
    const loads = series({ reading: 1000 }, { reading: null, liters: 40 }, { reading: 1600, liters: 20 })
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ performanceStatus: "no_meter", performanceValue: null })
    expect(result[2]).toMatchObject({ performanceStatus: "computed", accumulatedLiters: 60, meterDelta: 600, performanceValue: 10, anchorLoadId: loads[0]!.id })
  })

  it("odómetro que retrocede: meter_regression marcado y el ancla no se mueve", () => {
    const loads = series({ reading: 1000 }, { reading: 900, liters: 30 }, { reading: 1500, liters: 20 })
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ performanceStatus: "meter_regression", reviewStatus: "flagged", flagReasons: ["meter_regression"] })
    // El ancla sigue en 1000 y los 30 L del retroceso se suman: 500 km ÷ 50 L.
    expect(result[2]).toMatchObject({ performanceStatus: "computed", anchorLoadId: loads[0]!.id, accumulatedLiters: 50, performanceValue: 10 })
  })

  it("lectura repetida: zero_delta y suma litros al tramo", () => {
    const result = computeVehicleSeries(truck, series({ reading: 1000 }, { reading: 1000, liters: 25 }, { reading: 1250, liters: 25 }), settings)
    expect(result[1]!.performanceStatus).toBe("zero_delta")
    expect(result[2]).toMatchObject({ accumulatedLiters: 50, performanceValue: 5 })
  })

  it("meter_reset parte la serie: la carga siguiente se mide contra el reinicio", () => {
    const loads = series({ reading: 90_000 }, { reading: 50, meterReset: true, liters: 80 }, { reading: 550, liters: 50 })
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ performanceStatus: "meter_reset", flagReasons: [], reviewStatus: "ok" })
    expect(result[2]).toMatchObject({ performanceStatus: "computed", anchorLoadId: loads[1]!.id, performanceValue: 10, accumulatedLiters: 50 })
  })

  it("equipo sin medidor o sin unidad: not_applicable", () => {
    const result = computeVehicleSeries({ meterType: "none", performanceUnit: "not_applicable", tankCapacityLiters: null }, series({ reading: 10 }), settings)
    expect(result[0]).toMatchObject({ performanceStatus: "not_applicable", performanceUnit: null, meterType: null })
  })

  it("la unidad sale del equipo, no de la fila", () => {
    const [, second] = computeVehicleSeries(loader, series({ reading: 100 }, { reading: 120, liters: 100 }), settings)
    expect(second!.performanceUnit).toBe("liters_per_hour")
    expect(second!.performanceValue).toBe(5)
  })
})

describe("computeVehicleSeries — marcas", () => {
  it("rendimiento implausible sobre 25 km/L", () => {
    const [, second] = computeVehicleSeries(truck, series({ reading: 1000 }, { reading: 1260, liters: 10 }), settings)
    expect(second).toMatchObject({ performanceValue: 26, reviewStatus: "flagged", flagReasons: ["implausible"] })
  })

  it("litros sobre la capacidad del estanque", () => {
    const [first] = computeVehicleSeries(truck, series({ reading: 1000, liters: 450 }), settings)
    expect(first).toMatchObject({ reviewStatus: "flagged", flagReasons: ["over_capacity"] })
  })

  it("conserva las marcas de origen y descarta las de serie viejas", () => {
    const [first] = computeVehicleSeries(truck, series({ reading: 1000, flagReasons: ["filler_value", "outlier"] }), settings)
    expect(first!.flagReasons).toEqual(["filler_value"])
    expect(first!.reviewStatus).toBe("flagged")
  })

  it("un valor de relleno sin aprobar queda fuera de la serie y no provoca retrocesos falsos", () => {
    // Fecha 1899-12-30 con lectura alta: ordenada primero, envenenaría la serie.
    const loads = [
      load({ at: "1899-12-30T12:00:00.000Z", reading: 999_999, flagReasons: ["filler_value"] }),
      ...series({ reading: 1000 }, { reading: 1500, liters: 50 }),
    ]
    const [filler, first, second] = computeVehicleSeries(truck, loads, settings)
    expect(filler).toMatchObject({ performanceStatus: "excluded", reviewStatus: "flagged", flagReasons: ["filler_value"] })
    expect(first).toMatchObject({ performanceStatus: "first_load", reviewStatus: "ok" })
    expect(second).toMatchObject({ performanceStatus: "computed", performanceValue: 10, flagReasons: [] })
  })

  it("un valor de relleno aprobado vuelve a la serie", () => {
    const loads = series({ reading: 1000, flagReasons: ["filler_value"], reviewStatus: "approved" }, { reading: 1500, liters: 50 })
    const [first, second] = computeVehicleSeries(truck, loads, settings)
    expect(first).toMatchObject({ performanceStatus: "first_load", reviewStatus: "approved" })
    expect(second).toMatchObject({ performanceStatus: "computed", performanceValue: 10 })
  })

  /** 5 cargas a 10 km/L con algo de dispersión, luego `last`. */
  function outlierSeries(last: Partial<SeriesLoad> & { reading?: number | null }, count = 5) {
    const readings = [1000]
    const perf = [10, 10.5, 9.5, 10.2, 9.8, 10.1]
    for (let i = 0; i < count; i++) readings.push(readings[i]! + perf[i]! * 50)
    const lastReading = readings[readings.length - 1]!
    return series(...readings.map((reading) => ({ reading, liters: 50 })), { liters: 50, ...last, reading: lastReading + (last.reading ?? 0) })
  }

  it("atípico solo con al menos minSamples cargas válidas previas", () => {
    // 4 muestras previas (< 5): 20 km/L no se juzga como atípico (sí está bajo 25).
    const short = computeVehicleSeries(truck, outlierSeries({ reading: 1000 }, 4), settings)
    expect(short.at(-1)!.flagReasons).toEqual([])
    // 5 muestras previas: el mismo salto ya es atípico.
    const full = computeVehicleSeries(truck, outlierSeries({ reading: 1000 }, 5), settings)
    expect(full.at(-1)).toMatchObject({ performanceValue: 20, reviewStatus: "flagged", flagReasons: ["outlier"] })
  })

  it("un valor dentro de k·σ no se marca", () => {
    const result = computeVehicleSeries(truck, outlierSeries({ reading: 505 }, 5), settings)
    expect(result.at(-1)).toMatchObject({ performanceValue: 10.1, flagReasons: [], reviewStatus: "ok" })
  })

  it("una atípica aprobada sigue aprobada al recalcular y entra a la media", () => {
    const loads = outlierSeries({ reading: 1000, reviewStatus: "approved" }, 5)
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result.at(-1)).toMatchObject({ reviewStatus: "approved", flagReasons: ["outlier"] })
    // La siguiente a 18 km/L ya no es atípica: el 20 aprobado ensanchó la media y σ.
    const next = computeVehicleSeries(truck, [...loads, load({ at: "2026-04-01T12:00:00.000Z", reading: loads.at(-1)!.meterReading! + 900, liters: 50 })], settings)
    expect(next.at(-1)).toMatchObject({ performanceValue: 18, flagReasons: [], reviewStatus: "ok" })
    // Sin la aprobación, la marcada no entra a la historia y la siguiente sí es atípica.
    const flagged = outlierSeries({ reading: 1000 }, 5)
    const without = computeVehicleSeries(truck, [...flagged, load({ at: "2026-04-01T12:00:00.000Z", reading: flagged.at(-1)!.meterReading! + 900, liters: 50 })], settings)
    expect(without.at(-1)!.flagReasons).toEqual(["outlier"])
  })

  it("una rechazada queda excluida y conserva su decisión", () => {
    const loads = series({ reading: 1000 }, { reading: 1100, reviewStatus: "rejected" }, { reading: 1500, liters: 50 })
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ performanceStatus: "excluded", reviewStatus: "rejected", performanceValue: null })
    expect(result[2]).toMatchObject({ anchorLoadId: loads[0]!.id, performanceValue: 10 })
  })

  it("una anulada queda excluida y fuera de la cola", () => {
    const loads = series({ reading: 1000 }, { reading: 1100, voidedAt: "2026-03-03T00:00:00Z", reviewStatus: "flagged", flagReasons: ["filler_value"] })
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ performanceStatus: "excluded", reviewStatus: "ok", flagReasons: ["filler_value"] })
  })
})

describe("computeVehicleSeries — duplicadas entre canales (S-7)", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 4, 1, 12, minutes)).toISOString()

  it("misma carga por planilla y terreno dentro de 15 min y ±0,5 L: la segunda es duplicada y se excluye", () => {
    const loads = [
      load({ at: at(0), source: "field", reading: 1000, liters: 100 }),
      load({ at: at(10), source: "operations_import", reading: 1000, liters: 100.4 }),
    ]
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ duplicateOfId: loads[0]!.id, performanceStatus: "excluded", reviewStatus: "flagged", flagReasons: ["duplicate"] })
  })

  it("fuera de la ventana no es duplicada", () => {
    const loads = [
      load({ at: at(0), source: "field", reading: 1000, liters: 100 }),
      load({ at: at(16), source: "operations_import", reading: 1000, liters: 100 }),
    ]
    expect(computeVehicleSeries(truck, loads, settings)[1]!.duplicateOfId).toBeNull()
  })

  it("mismo canal no es duplicada, ni con litros fuera de tolerancia", () => {
    const sameSource = [load({ at: at(0), reading: 1000 }), load({ at: at(5), reading: 1000 })]
    expect(computeVehicleSeries(truck, sameSource, settings)[1]!.duplicateOfId).toBeNull()
    const liters = [load({ at: at(0), source: "field", liters: 100 }), load({ at: at(5), source: "legacy_tae", liters: 101 })]
    expect(computeVehicleSeries(truck, liters, settings)[1]!.duplicateOfId).toBeNull()
  })

  it("una duplicada aprobada («no es duplicada») no se vuelve a marcar", () => {
    const loads = [
      load({ at: at(0), source: "field", reading: 1000 }),
      load({ at: at(5), source: "operations_import", reading: 1500, liters: 100, reviewStatus: "approved" }),
    ]
    const result = computeVehicleSeries(truck, loads, settings)
    expect(result[1]).toMatchObject({ duplicateOfId: null, performanceStatus: "computed", reviewStatus: "approved" })
  })
})

describe("parseInstantMs", () => {
  it("lee ISO y el formato de Postgres con desfase corto", () => {
    expect(parseInstantMs("2026-01-15 12:00:00+00")).toBe(Date.UTC(2026, 0, 15, 12))
    expect(parseInstantMs("2026-01-15T12:00:00.000Z")).toBe(Date.UTC(2026, 0, 15, 12))
  })
})
