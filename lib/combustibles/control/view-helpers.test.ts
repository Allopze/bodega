import { describe, expect, it } from "vitest"
import {
  NO_MEDIUM_KEY,
  NO_MEDIUM_LABEL,
  buildCrosstab,
  coefficientOfVariation,
  deltaPct,
  fillMonthKeys,
  globalRatio,
  isWorsePerformance,
  monthFullLabel,
  monthShortLabel,
  periodStartPlainDate,
  pivotMonthlyByMedium,
  shiftPlainDateByMonths,
} from "./view-helpers"

describe("meses", () => {
  it("etiqueta en español", () => {
    expect(monthShortLabel("2026-03")).toBe("Mar 26")
    expect(monthFullLabel("2026-12")).toBe("Dic 2026")
  })

  it("rellena los meses sin datos entre el primero y el último, cruzando el año", () => {
    expect(fillMonthKeys(["2026-11", "2027-02", "2026-11"])).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"])
    expect(fillMonthKeys([])).toEqual([])
  })
})

describe("pivotMonthlyByMedium", () => {
  const rows = [
    { month: "2026-01", mediumId: "fsm-tae", mediumName: "TAE", mediumOrder: 2, liters: 100 },
    { month: "2026-01", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 40 },
    { month: "2026-03", mediumId: null, mediumName: null, mediumOrder: null, liters: 7 },
    { month: "2026-03", mediumId: "fsm-tae", mediumName: "TAE", mediumOrder: 2, liters: 3 },
  ]

  it("ordena los medios por el catálogo y deja «Sin medio informado» al final", () => {
    const { series } = pivotMonthlyByMedium(rows)
    expect(series.map((item) => item.label)).toEqual(["TCT", "TAE", NO_MEDIUM_LABEL])
  })

  it("rellena el mes sin cargas con ceros y suma el total del mes", () => {
    const { points, series } = pivotMonthlyByMedium(rows)
    expect(points.map((point) => point.month)).toEqual(["2026-01", "2026-02", "2026-03"])
    const keyOf = (label: string) => series.find((item) => item.label === label)!.key
    expect(points[0]).toMatchObject({ total: 140, [keyOf("TCT")]: 40, [keyOf("TAE")]: 100, [keyOf(NO_MEDIUM_LABEL)]: 0 })
    expect(points[1]).toMatchObject({ total: 0 })
    expect(points[2]).toMatchObject({ total: 10, [keyOf(NO_MEDIUM_LABEL)]: 7 })
  })
})

describe("buildCrosstab", () => {
  const crosstab = buildCrosstab([
    { worksiteId: "w1", worksiteName: "Faena 1", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 100 },
    { worksiteId: "w1", worksiteName: "Faena 1", mediumId: null, mediumName: null, mediumOrder: null, liters: 5 },
    { worksiteId: "w2", worksiteName: "Faena 2", mediumId: "fsm-tae", mediumName: "TAE", mediumOrder: 2, liters: 50 },
    { worksiteId: "w2", worksiteName: "Faena 2", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 25 },
  ])

  it("arma columnas por medio presente, con el sin-medio al final", () => {
    expect(crosstab.columns.map((column) => column.key)).toEqual(["fsm-tct", "fsm-tae", NO_MEDIUM_KEY])
  })

  it("calcula totales de fila, de columna y general consistentes", () => {
    expect(crosstab.rows.map((row) => row.total)).toEqual([105, 75])
    expect(crosstab.columnTotals).toEqual({ "fsm-tct": 125, "fsm-tae": 50, [NO_MEDIUM_KEY]: 5 })
    expect(crosstab.grandTotal).toBe(180)
    expect(Object.values(crosstab.columnTotals).reduce((sum, value) => sum + value, 0)).toBe(crosstab.grandTotal)
  })

  it("sin filas devuelve una tabla vacía con total cero", () => {
    expect(buildCrosstab([])).toEqual({ columns: [], rows: [], columnTotals: {}, grandTotal: 0 })
  })
})

describe("globalRatio", () => {
  it("km/L es Σkm ÷ Σlitros y L/h es Σlitros ÷ Σhoras", () => {
    expect(globalRatio("km_per_liter", 300, 100)).toBe(3)
    expect(globalRatio("liters_per_hour", 40, 200)).toBe(5)
  })

  it("devuelve null cuando el divisor es cero", () => {
    expect(globalRatio("km_per_liter", 10, 0)).toBeNull()
    expect(globalRatio("liters_per_hour", 0, 10)).toBeNull()
  })
})

describe("dispersión y comparaciones", () => {
  it("coeficiente de variación", () => {
    expect(coefficientOfVariation(4, 1)).toBe(0.25)
    expect(coefficientOfVariation(4, null)).toBeNull()
    expect(coefficientOfVariation(0, 1)).toBeNull()
  })

  it("variación porcentual", () => {
    expect(deltaPct(9, 10)).toBeCloseTo(-10)
    expect(deltaPct(11, 10)).toBeCloseTo(10)
    expect(deltaPct(5, null)).toBeNull()
    expect(deltaPct(5, 0)).toBeNull()
  })

  it("«rinde peor»: km/L baja, L/h sube, y solo pasado el 10 %", () => {
    expect(isWorsePerformance("km_per_liter", -10.5)).toBe(true)
    expect(isWorsePerformance("km_per_liter", -10)).toBe(false)
    expect(isWorsePerformance("km_per_liter", 20)).toBe(false)
    expect(isWorsePerformance("liters_per_hour", 12)).toBe(true)
    expect(isWorsePerformance("liters_per_hour", -30)).toBe(false)
    expect(isWorsePerformance("liters_per_hour", null)).toBe(false)
  })
})

describe("período", () => {
  it("el inicio es el desde del rango o el 1.º del primer mes elegido", () => {
    expect(periodStartPlainDate({ year: 2026, months: [], from: undefined })).toBe("2026-01-01")
    expect(periodStartPlainDate({ year: 2026, months: [5, 3, 9], from: undefined })).toBe("2026-03-01")
    expect(periodStartPlainDate({ year: 2026, months: [3], from: "2026-02-10" })).toBe("2026-02-10")
  })

  it("resta meses acotando el día al fin del mes destino", () => {
    expect(shiftPlainDateByMonths("2026-03-01", -12)).toBe("2025-03-01")
    expect(shiftPlainDateByMonths("2026-03-31", -1)).toBe("2026-02-28")
    expect(shiftPlainDateByMonths("2026-01-15", -2)).toBe("2025-11-15")
  })
})
