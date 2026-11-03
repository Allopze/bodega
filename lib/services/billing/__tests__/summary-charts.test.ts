/**
 * CHART-036 (AUDITORIA_VISUALIZACIONES_CHOME.md): derivaciones puras de
 * `/facturacion` — la serie mensual por moneda, la variación contra el mes
 * anterior, los rankings por moneda y la antigüedad de la deuda.
 *
 * Todas operan sobre el `BillingSummary` que ya entrega el servicio: no hay un
 * dato nuevo, sólo se deja de tirar `summary.monthly`. La regla que las
 * atraviesa es que **nunca se suman monedas distintas**.
 */
import { describe, expect, it } from "vitest"
import {
  agingBucketsFor,
  agingCurrencies,
  agingInsight,
  agingTable,
  billingPeriodLabel,
  changesByCurrency,
  compareCurrencies,
  flowInsight,
  flowSeriesByCurrency,
  flowTable,
  previousMonthChange,
  previousPeriod,
  rankingByCurrency,
} from "../summary-charts"

const monthly = [
  { period: "2026-08", currency: "CLP", invoiced: 1_000, collected: 400 },
  { period: "2026-10", currency: "CLP", invoiced: 3_000, collected: 0 },
  { period: "2026-09", currency: "USD", invoiced: 50, collected: 50 },
  { period: "2026-11", currency: "CLP", invoiced: 9_999, collected: 9_999 },
]

describe("billingPeriodLabel", () => {
  it("rotula el período en español y deja pasar lo que no calza", () => {
    expect(billingPeriodLabel("2026-07")).toBe("Jul 2026")
    expect(billingPeriodLabel("2026-12")).toBe("Dic 2026")
    expect(billingPeriodLabel("2026")).toBe("2026")
    expect(billingPeriodLabel("2026-13")).toBe("2026-13")
  })
})

describe("previousPeriod", () => {
  it("retrocede un mes y cruza el año", () => {
    expect(previousPeriod("2026-03")).toBe("2026-02")
    expect(previousPeriod("2026-01")).toBe("2025-12")
  })
})

describe("compareCurrencies", () => {
  it("pone CLP primero y el resto por orden alfabético", () => {
    expect(["USD", "CLP", "EUR"].sort(compareCurrencies)).toEqual(["CLP", "EUR", "USD"])
  })
})

describe("flowSeriesByCurrency", () => {
  it("separa por moneda, corta en el período elegido y rellena con cero los meses sin facturas", () => {
    const series = flowSeriesByCurrency(monthly, "2026-10")

    expect(series.map((entry) => entry.currency)).toEqual(["CLP", "USD"])
    // noviembre queda fuera (posterior al período) y septiembre, sin facturas CLP, es un cero real.
    expect(series[0]!.rows).toEqual([
      { period: "2026-08", invoiced: 1_000, collected: 400 },
      { period: "2026-09", invoiced: 0, collected: 0 },
      { period: "2026-10", invoiced: 3_000, collected: 0 },
    ])
    expect(series[1]!.rows).toEqual([{ period: "2026-09", invoiced: 50, collected: 50 }])
  })

  it("no mezcla monedas: las cifras de una no aparecen en la otra", () => {
    const [clp, usd] = flowSeriesByCurrency(monthly, "2026-12")
    expect(clp!.rows.every((row) => row.invoiced === 0 || row.invoiced >= 1_000)).toBe(true)
    expect(usd!.rows).toHaveLength(1)
  })

  it("suma las filas repetidas de un mismo mes y moneda", () => {
    const series = flowSeriesByCurrency([
      { period: "2026-10", currency: "CLP", invoiced: 100, collected: 10 },
      { period: "2026-10", currency: "CLP", invoiced: 200, collected: 20 },
    ], "2026-10")
    expect(series[0]!.rows).toEqual([{ period: "2026-10", invoiced: 300, collected: 30 }])
  })

  it("descarta la moneda sin ningún monto y devuelve [] sin datos", () => {
    expect(flowSeriesByCurrency([{ period: "2026-10", currency: "USD", invoiced: 0, collected: 0 }], "2026-10")).toEqual([])
    expect(flowSeriesByCurrency([], "2026-10")).toEqual([])
  })
})

describe("previousMonthChange", () => {
  const rows = [
    { period: "2026-09", currency: "CLP", invoiced: 1_000, collected: 800 },
    { period: "2026-09", currency: "USD", invoiced: 10, collected: 10 },
    { period: "2026-10", currency: "CLP", invoiced: 1_500, collected: 300 },
  ]

  it("es la variación porcentual contra el mes anterior de la misma moneda", () => {
    expect(previousMonthChange(rows, "2026-10", "CLP", "invoiced", 1_500)).toBe(50)
    expect(previousMonthChange(rows, "2026-10", "CLP", "invoiced", 500)).toBe(-50)
    expect(previousMonthChange(rows, "2026-10", "CLP", "collected", 400)).toBe(-50)
  })

  it("no se inventa: sin mes anterior, o con anterior en cero, no hay variación", () => {
    expect(previousMonthChange(rows, "2026-09", "CLP", "invoiced", 1_000)).toBeNull()
    expect(previousMonthChange(rows, "2026-10", "EUR", "invoiced", 5)).toBeNull()
    expect(previousMonthChange([{ period: "2026-09", currency: "CLP", invoiced: 0, collected: 0 }], "2026-10", "CLP", "invoiced", 100)).toBeNull()
  })

  it("el mes anterior de enero es diciembre del año previo", () => {
    const enero = [{ period: "2025-12", currency: "CLP", invoiced: 200, collected: 0 }]
    expect(previousMonthChange(enero, "2026-01", "CLP", "invoiced", 300)).toBe(50)
  })

  it("changesByCurrency da una variación por cada moneda del tile", () => {
    expect(changesByCurrency(rows, "2026-10", "invoiced", [
      { currency: "CLP", amount: 1_500 },
      { currency: "USD", amount: 20 },
    ])).toEqual({ CLP: 50, USD: 100 })
  })
})

describe("rankingByCurrency", () => {
  const rows = [
    { label: "Minera A", currency: "CLP", amount: 100 },
    { label: "Cliente B", currency: "USD", amount: 5 },
    { label: "Minera C", currency: "CLP", amount: 300 },
    { label: "Sin monto", currency: "CLP", amount: 0 },
    { label: "Minera A", currency: "USD", amount: 7 },
  ]

  it("hace una lista por moneda, ordenada de mayor a menor, sin sumar monedas", () => {
    const groups = rankingByCurrency(rows)
    expect(groups.map((group) => group.currency)).toEqual(["CLP", "USD"])
    expect(groups[0]!.items.map((item) => [item.label, item.value])).toEqual([["Minera C", 300], ["Minera A", 100]])
    expect(groups[1]!.items.map((item) => [item.label, item.value])).toEqual([["Minera A", 7], ["Cliente B", 5]])
  })

  it("las claves son únicas aunque un nombre se repita entre monedas", () => {
    const keys = rankingByCurrency(rows).flatMap((group) => group.items.map((item) => item.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("con el total facturado de la moneda, cada fila dice su parte; sin él, no inventa", () => {
    const groups = rankingByCurrency(rows, [{ currency: "CLP", amount: 1_000 }])
    expect(groups[0]!.items[0]!.detail).toBe("30% de lo facturado")
    expect(groups[1]!.items[0]!.detail).toBeUndefined()
  })

  it("si el vínculo supera el total facturado (datos incoherentes) omite el porcentaje", () => {
    const groups = rankingByCurrency([{ label: "X", currency: "CLP", amount: 2_000 }], [{ currency: "CLP", amount: 1_000 }])
    expect(groups[0]!.items[0]!.detail).toBeUndefined()
  })

  it("sin filas con monto devuelve []", () => {
    expect(rankingByCurrency([])).toEqual([])
    expect(rankingByCurrency([{ label: "X", currency: "CLP", amount: 0 }])).toEqual([])
  })
})

describe("antigüedad de la deuda", () => {
  const aging = [
    { bucket: "not_due" as const, label: "No vencida", count: 2, byCurrency: [{ currency: "CLP", amount: 100 }] },
    { bucket: "d1_30" as const, label: "1–30 días", count: 1, byCurrency: [{ currency: "CLP", amount: 200 }, { currency: "USD", amount: 9 }] },
    { bucket: "d31_60" as const, label: "31–60 días", count: 0, byCurrency: [] },
    { bucket: "d61_90" as const, label: "61–90 días", count: 1, byCurrency: [{ currency: "CLP", amount: 300 }] },
    { bucket: "d90_plus" as const, label: "Más de 90 días", count: 3, byCurrency: [{ currency: "CLP", amount: 400 }] },
  ]

  it("conserva el orden cronológico de los tramos y toma sólo la moneda pedida", () => {
    const buckets = agingBucketsFor(aging, "CLP", true)
    expect(buckets.map((bucket) => bucket.key)).toEqual(["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"])
    expect(buckets.map((bucket) => bucket.amount)).toEqual([100, 200, 0, 300, 400])
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 1, 0, 1, 3])
    expect(agingBucketsFor(aging, "USD", false).map((bucket) => bucket.amount)).toEqual([0, 9, 0, 0, 0])
  })

  it("agingCurrencies da las monedas con saldo (CLP primero) y avisa cuando hay varias", () => {
    expect(agingCurrencies(aging)).toEqual({ charted: ["CLP", "USD"], singleCurrency: false })
    expect(agingCurrencies(aging.slice(0, 1))).toEqual({ charted: ["CLP"], singleCurrency: true })
    expect(agingCurrencies([])).toEqual({ charted: [], singleCurrency: true })
    // Una moneda sin saldo (todo en cero) no se dibuja, pero sigue siendo «otra moneda» para el conteo.
    expect(agingCurrencies([{ bucket: "d1_30" as const, label: "1–30 días", count: 1, byCurrency: [{ currency: "EUR", amount: 0 }, { currency: "CLP", amount: 5 }] }]))
      .toEqual({ charted: ["CLP"], singleCurrency: false })
  })

  it("con varias monedas no da conteo de facturas (el del servicio suma todas)", () => {
    expect(agingBucketsFor(aging, "CLP", false).every((bucket) => bucket.count === null)).toBe(true)
  })

  it("la frase dice qué parte del saldo lleva más de 30 días vencida", () => {
    const buckets = agingBucketsFor(aging, "CLP", true)
    // 300 + 400 de un total de 1.000.
    expect(agingInsight(buckets, "CLP")).toBe("El 70% del saldo lleva más de 30 días vencido: $700.")
  })

  it("sin saldo pasado de 30 días, o sin vencimientos, lo dice con otras palabras", () => {
    const reciente = agingBucketsFor(aging.slice(0, 2), "CLP", true)
    expect(agingInsight(reciente, "CLP")).toBe("Ningún saldo lleva más de 30 días vencido.")
    const alDia = agingBucketsFor(aging.slice(0, 1), "CLP", true)
    expect(agingInsight(alDia, "CLP")).toBe("Todo el saldo está al día: ninguna factura ha vencido.")
    expect(agingInsight(agingBucketsFor([], "CLP", true), "CLP")).toBeNull()
  })

  it("la alternativa en datos es la misma tabla de siempre: tramo, facturas y saldo por moneda", () => {
    const table = agingTable(aging)
    expect(table.headers).toEqual(["Tramo", "Facturas", "Saldo"])
    expect(table.rows[0]).toEqual(["No vencida", 2, "$100"])
    expect(table.rows[1]![2]).toContain("$200")
    expect(table.rows[1]![2]).toContain("US$")
    expect(table.rows[2]).toEqual(["31–60 días", 0, "—"])
  })

  it("por moneda toma sólo su saldo y, con varias monedas, omite el conteo que las suma todas", () => {
    const usd = agingTable(aging, { currency: "USD", withCounts: false })
    expect(usd.headers).toEqual(["Tramo", "Saldo"])
    expect(usd.rows[0]).toEqual(["No vencida", "—"])
    expect(usd.rows[1]![1]).toContain("US$")
    expect(usd.rows[1]![1]).not.toContain("$200")
  })
})

describe("facturado y cobrado: frase y tabla", () => {
  const series = {
    currency: "CLP",
    rows: [
      { period: "2026-07", invoiced: 1_000, collected: 800 },
      { period: "2026-08", invoiced: 1_000, collected: 0 },
      { period: "2026-09", invoiced: 0, collected: 0 },
    ],
  }

  it("resume la ventana: cuánto se facturó y qué parte está cobrada", () => {
    expect(flowInsight(series)).toBe("Entre julio y septiembre de 2026 se facturaron $2.000 y el 40% está cobrado.")
  })

  it("si la ventana cruza de año, cada extremo lleva el suyo", () => {
    expect(flowInsight({ currency: "CLP", rows: [{ period: "2025-12", invoiced: 100, collected: 100 }, { period: "2026-01", invoiced: 100, collected: 0 }] }))
      .toBe("Entre diciembre de 2025 y enero de 2026 se facturaron $200 y el 50% está cobrado.")
  })

  it("con un solo mes no dice «entre»", () => {
    expect(flowInsight({ currency: "CLP", rows: [{ period: "2026-10", invoiced: 500, collected: 250 }] }))
      .toBe("En octubre de 2026 se facturaron $500 y el 50% está cobrado.")
  })

  it("avisa que el mes en curso es parcial", () => {
    const text = flowInsight({ currency: "CLP", rows: [{ period: "2026-09", invoiced: 10, collected: 0 }, { period: "2026-10", invoiced: 10, collected: 0 }] }, "2026-10")
    expect(text).toContain("Octubre de 2026 está en curso y su cifra es parcial.")
  })

  it("en otra moneda usa el símbolo de esa moneda", () => {
    expect(flowInsight({ currency: "USD", rows: [{ period: "2026-10", invoiced: 100, collected: 0 }] })).toContain("US$")
  })

  it("la tabla da un renglón por mes y deja «—» donde no hay facturado", () => {
    const table = flowTable(series)
    expect(table.headers).toEqual(["Mes", "Facturado", "Cobrado", "Cobrado %"])
    expect(table.rows[0]).toEqual(["Jul 2026", "$1.000", "$800", "80%"])
    expect(table.rows[2]).toEqual(["Sep 2026", "$0", "$0", "—"])
  })
})
