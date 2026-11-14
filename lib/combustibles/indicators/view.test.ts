import { describe, expect, it } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { FuelPeriod } from "@/lib/combustibles/period/types"
import type { FuelMonthlyPoint } from "@/lib/services/dashboard-fuel"
import {
  idleWindowTotals,
  indicatorWindows,
  ledgerChartPoints,
  ledgerCost,
  ledgerHasData,
  litersCostTable,
  mediumTable,
  monthAxisLabels,
  topShare,
  windowCaption,
} from "./view"

const resolve = (period: FuelPeriod, today: string) => describeFuelPeriod(period, "url", today)
const OCT: FuelPeriod = { kind: "month", year: 2026, month: 10 }

function point(monthKey: string, overrides: Partial<FuelMonthlyPoint> = {}): FuelMonthlyPoint {
  return { month: monthKey.slice(5), monthKey, liters: 1000, amount: 1_000_000, loads: 10, providerGap: false, partial: false, ...overrides }
}

describe("indicatorWindows", () => {
  it("un mes: los gráficos muestran 6 meses que terminan en el período y el libro alcanza al período anterior", () => {
    const windows = indicatorWindows(resolve(OCT, "2026-11-13"))
    expect(windows.chart.monthKeys).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
    expect(windows.chart.isHistory).toBe(true)
    expect(windows.ledgerLastMonth).toBe("2026-10")
    expect(windows.ledgerMonths).toBe(6)
    expect(windows.previous?.monthKeys).toEqual(["2026-09"])
  })

  it("un año: los gráficos muestran el año y el libro se extiende hasta el año anterior", () => {
    const windows = indicatorWindows(resolve({ kind: "year", year: 2026 }, "2026-11-13"))
    expect(windows.chart.isHistory).toBe(false)
    expect(windows.chart.monthKeys).toHaveLength(12)
    expect(windows.ledgerLastMonth).toBe("2026-12")
    // Enero de 2025 a diciembre de 2026.
    expect(windows.ledgerMonths).toBe(24)
  })

  it("una semana a caballo de dos meses: la ventana termina en el mes donde termina la semana", () => {
    const windows = indicatorWindows(resolve({ kind: "week", year: 2026, week: 44 }, "2026-11-13"))
    // La semana 44 de 2026 va del 26 de octubre al 1 de noviembre.
    expect(windows.ledgerLastMonth).toBe("2026-11")
    expect(windows.chart.monthKeys.at(-1)).toBe("2026-11")
  })
})

describe("windowCaption", () => {
  it("dice la ventana de meses cuando el gráfico muestra historia y el período cuando no", () => {
    const month = resolve(OCT, "2026-11-13")
    expect(windowCaption(indicatorWindows(month).chart, month)).toBe("Últimos 6 meses, hasta octubre de 2026")
    const year = resolve({ kind: "year", year: 2026 }, "2026-11-13")
    expect(windowCaption(indicatorWindows(year).chart, year)).toBe("Año 2026")
  })
})

describe("ledgerCost", () => {
  const period = resolve(OCT, "2026-11-13")
  const previous = indicatorWindows(period).previous

  it("suma el costo del período y lo compara con el anterior", () => {
    const cost = ledgerCost([point("2026-09", { amount: 800_000 }), point("2026-10", { amount: 1_000_000, liters: 1200 })], period, previous)
    expect(cost).toEqual({ amount: 1_000_000, liters: 1200, pct: 25, gapMonths: [] })
  })

  it("un período en curso no se compara con uno completo", () => {
    const current = resolve({ kind: "month", year: 2026, month: 11 }, "2026-11-13")
    const cost = ledgerCost([point("2026-10", { amount: 5_000_000 }), point("2026-11", { amount: 600_000 })], current, indicatorWindows(current).previous)
    expect(cost.amount).toBe(600_000)
    expect(cost.pct).toBeNull()
  })

  it("un mes sin datos del proveedor es un hueco: no es cero ni permite comparar", () => {
    const withGap = ledgerCost([point("2026-09", { liters: null, amount: null, loads: null, providerGap: true }), point("2026-10")], period, previous)
    expect(withGap.amount).toBe(1_000_000)
    expect(withGap.pct).toBeNull()
    const allGap = ledgerCost([point("2026-10", { liters: null, amount: null, loads: null, providerGap: true })], period, previous)
    expect(allGap).toMatchObject({ amount: null, liters: null, pct: null, gapMonths: ["2026-10"] })
  })

  it("sin permiso de costos no hay monto, pero los litros siguen", () => {
    const cost = ledgerCost([point("2026-09", { amount: null }), point("2026-10", { amount: null, liters: 900 })], period, previous)
    expect(cost.amount).toBeNull()
    expect(cost.liters).toBe(900)
    expect(cost.pct).toBeNull()
  })

  it("un costo anterior en cero no da una variación infinita", () => {
    const cost = ledgerCost([point("2026-09", { amount: 0 }), point("2026-10")], period, previous)
    expect(cost.pct).toBeNull()
  })

  it("un trimestre toma los tres meses y se compara con los tres anteriores", () => {
    const quarter = resolve({ kind: "quarter", year: 2026, quarter: 3 }, "2026-11-13")
    const points = ["2026-04", "2026-05", "2026-06"].map((key) => point(key, { amount: 100 }))
      .concat(["2026-07", "2026-08", "2026-09"].map((key) => point(key, { amount: 150 })))
    const cost = ledgerCost(points, quarter, indicatorWindows(quarter).previous)
    expect(cost.amount).toBe(450)
    expect(cost.pct).toBe(50)
  })
})

describe("rótulos y puntos de los gráficos", () => {
  it("el eje usa el mes corto y suma el año sólo cuando un mes se repite", () => {
    expect(monthAxisLabels(["2026-09", "2026-10"])).toEqual(["Sep", "Oct"])
    expect(monthAxisLabels(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]).at(0)).toBe("Sep 25")
  })

  it("los puntos del gráfico son los de la ventana, en orden, aunque el libro traiga más meses", () => {
    const points = ledgerChartPoints([point("2026-08"), point("2026-09"), point("2026-10")], ["2026-09", "2026-10"])
    expect(points.map((item) => [item.monthKey, item.month])).toEqual([["2026-09", "Sep"], ["2026-10", "Oct"]])
  })

  it("el gráfico se dibuja con litros, o con costo sólo si la persona lo ve", () => {
    const onlyCost = ledgerChartPoints([point("2026-10", { liters: 0, amount: 50 })], ["2026-10"])
    expect(ledgerHasData(onlyCost, true)).toBe(true)
    expect(ledgerHasData(onlyCost, false)).toBe(false)
    expect(ledgerHasData(ledgerChartPoints([point("2026-10", { liters: null, amount: null, providerGap: true })], ["2026-10"]), true)).toBe(false)
  })

  it("«Ver datos» deja un hueco con «—» y lo dice, y omite el costo sin permiso", () => {
    const points = ledgerChartPoints([point("2026-09", { liters: null, amount: null, loads: null, providerGap: true }), point("2026-10", { partial: true })], ["2026-09", "2026-10"])
    const withCosts = litersCostTable(points, true)
    expect(withCosts.headers).toEqual(["Mes", "Litros", "Costo", "Cargas", "Observación"])
    expect(withCosts.rows[0]).toEqual(["Septiembre 2026", "—", "—", "—", "Sin datos del proveedor"])
    expect(withCosts.rows[1]?.[4]).toBe("Mes en curso")
    expect(litersCostTable(points, false).headers).toEqual(["Mes", "Litros", "Cargas", "Observación"])
  })

  it("la tabla por medio trae una columna por medio y el total del mes", () => {
    const table = mediumTable({
      series: [{ key: "m0", label: "Estanque" }, { key: "m1", label: "Tarjeta" }],
      points: [{ month: "2026-10", label: "Oct 26", fullLabel: "Oct 2026", total: 300, m0: 100, m1: 200 }],
    })
    expect(table.headers).toEqual(["Mes", "Estanque", "Tarjeta", "Total"])
    expect(table.rows).toEqual([["Oct 2026", "100", "200", "300"]])
  })
})

describe("ralentí y rankings", () => {
  it("el total de la ventana suma los litros en vacío y su % usa sólo los meses con ambos litros", () => {
    const totals = idleWindowTotals([
      { month: "2026-08", litersIdle: 100, litersWorking: 900, idleLitersPct: 10 },
      { month: "2026-09", litersIdle: 300, litersWorking: 700, idleLitersPct: 30 },
      { month: "2026-10", litersIdle: 50, litersWorking: null, idleLitersPct: null },
    ])
    expect(totals?.litersIdle).toBe(450)
    expect(totals?.pct).toBeCloseTo(20, 5)
  })

  it("sin litros informados no hay total (no es un cero)", () => {
    expect(idleWindowTotals([{ month: "2026-10", litersIdle: null, litersWorking: null, idleLitersPct: null }])).toBeNull()
  })

  it("el titular de un ranking es el primero y su parte del total", () => {
    expect(topShare([{ label: "A", value: 30 }, { label: "B", value: 70 }])).toEqual({ label: "B", value: 70, sharePct: 70 })
    expect(topShare([])).toBeNull()
    expect(topShare([{ label: "A", value: 0 }])).toBeNull()
  })
})
