import { describe, expect, it } from "vitest"
import type { SpendByMonthRow } from "@/lib/services/analytics"
import {
  formatTrendMonth,
  formatTrendMonthShort,
  fuelGapMonthKeys,
  isIsolatedPoint,
  monthlyTrendDescription,
  trendChartRows,
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
  it("nombra el mes sin datos del proveedor", () => {
    expect(monthlyTrendDescription("2026-10-31", false, ["2026-09"])).toBe("Últimos 12 meses hasta oct-2026 · sin datos del proveedor de combustible en sep-2026")
  })

  it("lista varios meses y los une con «y»", () => {
    expect(monthlyTrendDescription("2026-10-31", true, ["2025-11", "2025-12", "2026-09"])).toBe(
      "Últimos 12 meses hasta oct-2026 · el último mes es parcial · sin datos del proveedor de combustible en nov-2025, dic-2025 y sep-2026",
    )
  })

  it("sin huecos no agrega nada", () => {
    expect(monthlyTrendDescription("2026-10-31", false, [])).toBe("Últimos 12 meses hasta oct-2026")
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

describe("trendChartRows", () => {
  it("en un mes con hueco el total también es null: sin combustible no es un total y su caída sería falsa", () => {
    const rows = trendChartRows([row("2026-08", 5), row("2026-09", null, 70)])

    expect(rows[0]).toMatchObject({ fuelAmount: 5, totalAmount: 15 })
    expect(rows[1]).toMatchObject({ fuelAmount: null, totalAmount: null, purchasingAmount: 70 })
  })

  it("las compras no se tocan: un cero ahí es real", () => {
    expect(trendChartRows([row("2026-09", null, 0)])[0]?.purchasingAmount).toBe(0)
  })
})

describe("trendTooltipEntry", () => {
  const money = (value: number) => "CLP " + String(value)

  it("rotula cada serie y formatea sus valores", () => {
    expect(trendTooltipEntry("totalAmount", 100, money)).toEqual(["CLP 100", "Total"])
    expect(trendTooltipEntry("Combustible", 50, money)).toEqual(["CLP 50", "Combustible"])
  })

  it("un combustible sin dato se dice con palabras, no como cero ni se omite", () => {
    expect(trendTooltipEntry("Combustible", null, money)).toEqual(["Sin datos del proveedor", "Combustible"])
    expect(trendTooltipEntry("totalAmount", null, money)).toEqual(["Sin total: falta el combustible", "Total"])
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
