import { describe, expect, it } from "vitest"
import type { SpendByMonthRow } from "@/lib/services/analytics"
import {
  areaChartRows,
  formatTrendMonth,
  formatTrendMonthShort,
  fuelGapMonthKeys,
  isIsolatedPoint,
  monthlyTrendDescription,
  monthlyTrendSummary,
  trendDataRows,
  trendTooltipEntry,
} from "./analytics-trend"

describe("formatTrendMonth", () => {
  it("escribe el mes como «oct-2026», igual que el subtítulo", () => {
    expect(formatTrendMonth("2026-10")).toBe("oct-2026")
    expect(formatTrendMonth("2025-01")).toBe("ene-2025")
  })

  it("devuelve el texto original si no es una clave de mes", () => {
    expect(formatTrendMonth("raro")).toBe("raro")
  })
})

describe("formatTrendMonthShort", () => {
  it("abrevia el año para que quepan los 12 meses en el eje", () => {
    expect(formatTrendMonthShort("2026-10")).toBe("oct-26")
    expect(formatTrendMonthShort("2025-01")).toBe("ene-25")
  })

  it("devuelve el texto original si no es una clave de mes", () => {
    expect(formatTrendMonthShort("raro")).toBe("raro")
  })
})

describe("monthlyTrendDescription", () => {
  it("nombra la ventana real de 12 meses a partir de la fecha `hasta`", () => {
    expect(monthlyTrendDescription("2026-10-31", false)).toBe("Últimos 12 meses hasta oct-2026")
  })

  it("agrega el aviso de mes parcial", () => {
    expect(monthlyTrendDescription("2026-10-20", true)).toBe("Últimos 12 meses hasta oct-2026 · el último mes es parcial")
  })
})

describe("monthlyTrendDescription · meses sin datos del proveedor (C-4)", () => {
  it("no los nombra: lo dice `CoverageNotice` bajo el gráfico, una sola vez (A5)", () => {
    expect(monthlyTrendDescription("2026-10-31", false)).toBe("Últimos 12 meses hasta oct-2026")
    expect(monthlyTrendDescription("2026-10-31", true)).toBe("Últimos 12 meses hasta oct-2026 · el último mes es parcial")
  })
})

const row = (month: string, fuelAmount: number | null, purchasingAmount = 10): SpendByMonthRow => ({
  month, purchasingAmount, fuelAmount, totalAmount: purchasingAmount + (fuelAmount ?? 0), partial: false,
})

describe("fuelGapMonthKeys", () => {
  it("devuelve los meses con combustible null, en orden", () => {
    expect(fuelGapMonthKeys([row("2026-08", 5), row("2026-09", null), row("2026-10", 0), row("2026-11", null)])).toEqual(["2026-09", "2026-11"])
  })
})

describe("areaChartRows", () => {
  it("en un mes sin datos del proveedor el combustible queda null (la capa se corta) y las compras no se tocan", () => {
    const rows = areaChartRows([row("2026-08", 5), row("2026-09", null, 70)], true)

    expect(rows[0]).toMatchObject({ month: "2026-08", purchasingAmount: 10, fuelAmount: 5 })
    expect(rows[1]).toMatchObject({ month: "2026-09", purchasingAmount: 70, fuelAmount: null })
  })

  it("un cero real de compras se dibuja como cero", () => {
    expect(areaChartRows([row("2026-09", 0, 0)], true)[0]).toMatchObject({ purchasingAmount: 0, fuelAmount: 0 })
  })

  it("sin permiso de costos de combustible la serie no existe: ni ceros ni huecos de algo que no se mide", () => {
    const rows = areaChartRows([row("2026-08", 0), row("2026-09", null)], false)

    expect(rows.every((r) => r.fuelAmount === null)).toBe(true)
  })

  it("marca el mes parcial", () => {
    expect(areaChartRows([{ ...row("2026-10", 1), partial: true }], true)[0]?.partial).toBe(true)
  })
})

describe("monthlyTrendSummary", () => {
  const money = (value: number) => `$${value}`
  const complete = (month: string, fuel: number | null, purchasing: number): SpendByMonthRow => ({ ...row(month, fuel, purchasing), partial: false })

  it("nombra la ventana y el mes completo de mayor gasto, calculado de los datos", () => {
    const rows = [complete("2026-07", 100, 400), complete("2026-08", 50, 900), complete("2026-09", 20, 100)]

    expect(monthlyTrendSummary("2026-09-30", rows, money)).toBe("Últimos 12 meses hasta sep-2026. Mayor gasto en un mes completo: ago-2026 ($950).")
  })

  it("un mes parcial no es candidato a «mayor»: tiene menos días que los demás", () => {
    const rows = [complete("2026-07", 100, 400), complete("2026-08", 50, 900), { ...row("2026-09", 20, 5000), partial: true }]

    expect(monthlyTrendSummary("2026-09-15", rows, money)).toBe("Últimos 12 meses hasta sep-2026 · el último mes es parcial. Mayor gasto en un mes completo: ago-2026 ($950).")
  })

  it("un mes sin datos del combustible tampoco compite: su total son sólo las compras", () => {
    const rows = [complete("2026-07", 100, 400), complete("2026-08", null, 9000)]

    expect(monthlyTrendSummary("2026-08-31", rows, money)).toBe(
      "Últimos 12 meses hasta ago-2026. Mayor gasto en un mes completo: jul-2026 ($500).",
    )
  })

  it("si ningún mes sirve para comparar lo dice en vez de elegir uno", () => {
    const rows = [complete("2026-08", null, 9000)]

    expect(monthlyTrendSummary("2026-08-31", rows, money)).toBe(
      "Últimos 12 meses hasta ago-2026. Ningún mes completo tiene todos los datos para compararse.",
    )
  })

  it("sin gasto no hay frase (el gráfico muestra su estado vacío)", () => {
    expect(monthlyTrendSummary("2026-09-30", [complete("2026-09", 0, 0)], money)).toBe("")
  })
})

describe("trendDataRows", () => {
  const money = (value: number) => `$${value}`

  it("una fila por mes con compras, combustible y total; el mes parcial se rotula", () => {
    const data = trendDataRows([{ ...row("2026-09", 5, 10), partial: true }], true, money)

    expect(data.headers).toEqual(["Mes", "Compras", "Combustible", "Total"])
    expect(data.rows).toEqual([["sep-2026 (parcial)", "$10", "$5", "$15"]])
  })

  it("un mes sin datos del proveedor lo dice y no inventa un total", () => {
    const data = trendDataRows([row("2026-09", null, 70)], true, money)

    expect(data.rows).toEqual([["sep-2026", "$70", "Sin datos del proveedor", "—"]])
  })

  it("sin permiso de costos de combustible sólo hay compras", () => {
    const data = trendDataRows([row("2026-09", 0, 70)], false, money)

    expect(data.headers).toEqual(["Mes", "Compras"])
    expect(data.rows).toEqual([["sep-2026", "$70"]])
  })
})

describe("trendTooltipEntry", () => {
  const money = (value: number) => "CLP " + String(value)

  it("rotula cada serie y formatea sus valores", () => {
    expect(trendTooltipEntry("Compras", 100, money)).toEqual(["CLP 100", "Compras"])
    expect(trendTooltipEntry("Combustible", 50, money)).toEqual(["CLP 50", "Combustible"])
  })

  it("un combustible sin dato se dice con palabras, no como cero ni se omite", () => {
    expect(trendTooltipEntry("Combustible", null, money)).toEqual(["Sin datos del proveedor", "Combustible"])
  })

  it("un cero real se muestra como cero", () => {
    expect(trendTooltipEntry("Combustible", 0, money)).toEqual(["CLP 0", "Combustible"])
  })
})

describe("isIsolatedPoint", () => {
  it("un punto con valor entre dos huecos (o en un extremo junto a un hueco) no tiene línea y necesita punto", () => {
    expect(isIsolatedPoint([5, null, 7], 2)).toBe(true)
    expect(isIsolatedPoint([null, 5, null], 1)).toBe(true)
    expect(isIsolatedPoint([5, null], 0)).toBe(true)
  })

  it("un punto unido a un vecino ya se ve en la línea", () => {
    expect(isIsolatedPoint([5, 6, null], 0)).toBe(false)
    expect(isIsolatedPoint([null, 5, 6], 1)).toBe(false)
  })

  it("un hueco no es un punto", () => {
    expect(isIsolatedPoint([5, null, 7], 1)).toBe(false)
  })

  it("una serie de un solo valor no se marca (recharts ya dibuja el punto único)", () => {
    expect(isIsolatedPoint([5], 0)).toBe(false)
  })
})
