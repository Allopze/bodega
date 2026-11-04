import { describe, expect, it } from "vitest"
import {
  addMonths,
  fillMonthSeries,
  monthOfDay,
  monthPeriodLabel,
  monthPeriodName,
  monthsBetween,
  windowStartDay,
} from "./monthly-series"

describe("aritmética de meses", () => {
  it("suma y resta meses cruzando el año", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12")
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-03", -14)).toBe("2025-01")
  })

  it("lista los meses entre dos extremos, ambos incluidos", () => {
    expect(monthsBetween("2026-10", "2027-01")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"])
    expect(monthsBetween("2026-10", "2026-10")).toEqual(["2026-10"])
    expect(monthsBetween("2026-11", "2026-10")).toEqual([])
    expect(monthsBetween("basura", "2026-10")).toEqual([])
  })

  it("la ventana de 12 meses parte el primer día del mes once atrás", () => {
    expect(windowStartDay("2026-11-03")).toBe("2025-12-01")
    expect(windowStartDay("2026-01-31", 3)).toBe("2025-11-01")
    expect(monthOfDay("2026-11-03")).toBe("2026-11")
  })

  it("rotula los meses en español", () => {
    expect(monthPeriodLabel("2026-08")).toBe("Ago 2026")
    expect(monthPeriodName("2026-08")).toBe("agosto")
    expect(monthPeriodName("2026-08", true)).toBe("agosto de 2026")
  })
})

describe("fillMonthSeries", () => {
  const empty = (month: string) => ({ month, n: 0 })

  it("rellena el hueco entre dos meses con datos en vez de unirlos como si fueran contiguos", () => {
    const series = fillMonthSeries([{ month: "2026-08", n: 3 }, { month: "2026-10", n: 5 }], { today: "2026-10-20", empty })
    expect(series.map((row) => [row.month, row.n])).toEqual([["2026-08", 3], ["2026-09", 0], ["2026-10", 5]])
  })

  it("llega hasta el mes en curso aunque no tenga filas, y lo marca parcial", () => {
    const series = fillMonthSeries([{ month: "2026-09", n: 4 }], { today: "2026-11-03", empty })
    expect(series.map((row) => [row.month, row.partial])).toEqual([["2026-09", false], ["2026-10", false], ["2026-11", true]])
  })

  it("parte del primer mes con datos, no del inicio de la ventana", () => {
    const series = fillMonthSeries([{ month: "2026-10", n: 1 }], { today: "2026-10-05", empty })
    expect(series).toHaveLength(1)
  })

  it("descarta lo que cae antes de la ventana", () => {
    const series = fillMonthSeries(
      [{ month: "2024-01", n: 9 }, { month: "2026-10", n: 1 }],
      { today: "2026-10-05", months: 6, empty },
    )
    expect(series.map((row) => row.month)).toEqual(["2026-10"])
  })

  it("sin ninguna fila no hay serie", () => {
    expect(fillMonthSeries([], { today: "2026-10-05", empty })).toEqual([])
  })
})
