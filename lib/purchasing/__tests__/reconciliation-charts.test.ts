/**
 * CHART-034 · conciliación OC–factura y cobertura de DTE.
 *
 * Módulo puro: las consultas traen conteos y montos por mes; aquí se arma la
 * serie, se decide qué se puede afirmar y se escribe la frase. Los bordes que
 * importan son los de la auditoría: el mes en curso (no una caída), una tasa con
 * pocos documentos (no un porcentaje con aire de certeza) y que la frase sea
 * verdad también cuando falta una parte de los datos.
 */
import { describe, expect, it } from "vitest"
import {
  DTE_LINK_ORDER,
  RECONCILIATION_STATUS_ORDER,
  dteCoverageSummary,
  dteCoverageTable,
  dteLinkColor,
  dteListHref,
  reconciliationMonths,
  reconciliationStatusColor,
  reconciliationSummary,
  reconciliationTable,
  shapeDteCoverage,
  shapeReconciliationMonths,
  type DteCoverageRow,
  type ReconciliationRow,
} from "../reconciliation-charts"

describe("reconciliationMonths", () => {
  it("12 meses terminando en el mes en curso, del más antiguo al más nuevo", () => {
    const months = reconciliationMonths("2026-11-03")
    expect(months).toHaveLength(12)
    expect(months[0]).toBe("2025-12")
    expect(months.at(-1)).toBe("2026-11")
  })

  it("cruza el año sin saltarse un mes", () => {
    expect(reconciliationMonths("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })
})

const row = (month: string, status: string, count: number, toInvoice = 0, withBalance = toInvoice > 0 ? count : 0): ReconciliationRow => ({ month, status, count, toInvoice, withBalance })

describe("shapeReconciliationMonths", () => {
  const months = reconciliationMonths("2026-11-03", 3)
  const shaped = shapeReconciliationMonths(
    [
      row("2026-09", "matched", 4),
      row("2026-10", "needs_review", 2, 500_000),
      row("2026-10", "no_invoices", 3, 1_200_000),
      row("2026-11", "partially_invoiced", 1, 300_000),
      // Fuera de la ventana y con un estado que no existe: no se cuentan.
      row("2024-01", "matched", 9),
      row("2026-10", "inventado", 7, 1),
    ],
    months,
    "2026-11-03",
  )

  it("una entrada por mes, con ceros donde no hubo OC", () => {
    expect(shaped.months.map((month) => month.month)).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(shaped.months[0]!.counts).toMatchObject({ matched: 4, needs_review: 0 })
    expect(shaped.months[1]!.total).toBe(5)
  })

  it("el mes en curso es parcial; los otros no", () => {
    expect(shaped.months.map((month) => month.partial)).toEqual([false, false, true])
  })

  it("totales: OC, monto por facturar y OC con saldo", () => {
    expect(shaped.totalOrders).toBe(10)
    expect(shaped.toInvoice).toBe(2_000_000)
    expect(shaped.ordersWithBalance).toBe(6)
    expect(shaped.needsReview).toBe(2)
  })

  it("ignora un monto por facturar negativo o corrupto en vez de restarlo", () => {
    const odd = shapeReconciliationMonths([row("2026-10", "matched", 1, -50), row("2026-10", "matched", 1, Number.NaN)], months, "2026-11-03")
    expect(odd.toInvoice).toBe(0)
  })
})

describe("reconciliationSummary", () => {
  const months = reconciliationMonths("2026-11-03", 3)

  it("responde cuánto queda por facturar y cuántas requieren revisión", () => {
    const shaped = shapeReconciliationMonths(
      [row("2026-10", "needs_review", 2, 500_000), row("2026-10", "no_invoices", 3, 1_200_000), row("2026-09", "matched", 4)],
      months,
      "2026-11-03",
    )
    expect(reconciliationSummary(shaped, 3)).toBe(
      "Quedan $1.700.000 por facturar en 5 de 9 OC emitidas en los últimos 3 meses. 2 requieren revisión.",
    )
  })

  it("si no queda nada por facturar lo dice, sin inventar un saldo", () => {
    const shaped = shapeReconciliationMonths([row("2026-10", "matched", 4, 0, 0)], months, "2026-11-03")
    expect(reconciliationSummary(shaped, 3)).toBe(
      "No queda nada por facturar en las 4 OC emitidas en los últimos 3 meses. Ninguna requiere revisión.",
    )
  })

  it("sin ninguna OC no hay frase (el gráfico explica el vacío)", () => {
    expect(reconciliationSummary(shapeReconciliationMonths([], months, "2026-11-03"), 3)).toBeNull()
  })

  it("concuerda en singular", () => {
    const shaped = shapeReconciliationMonths([row("2026-10", "needs_review", 1, 100)], months, "2026-11-03")
    expect(reconciliationSummary(shaped, 3)).toBe("Quedan $100 por facturar en la única OC emitida en los últimos 3 meses. 1 requiere revisión.")
  })
})

describe("colores y tabla", () => {
  it("los estados vecinos en la pila no comparten color y todos son tokens", () => {
    const colors = RECONCILIATION_STATUS_ORDER.map((status) => reconciliationStatusColor(status))
    colors.slice(1).forEach((color, index) => expect(color).not.toBe(colors[index]))
    expect(colors.every((color) => color.startsWith("var(--color-"))).toBe(true)
    expect(new Set(colors).size).toBe(RECONCILIATION_STATUS_ORDER.length)
  })

  it("el estado que pide revisión va en danger", () => {
    expect(reconciliationStatusColor("needs_review")).toBe("var(--color-danger)")
  })

  it("«Ver datos» trae un renglón por mes con cada estado, el total y el monto por facturar en pesos", () => {
    const shaped = shapeReconciliationMonths([row("2026-10", "needs_review", 2, 500_000)], reconciliationMonths("2026-11-03", 2), "2026-11-03")
    const table = reconciliationTable(shaped)
    expect(table.headers[0]).toBe("Mes de emisión")
    expect(table.headers.at(-1)).toBe("Por facturar")
    expect(table.rows[0]).toEqual(["octubre 2026", ...RECONCILIATION_STATUS_ORDER.map((status) => (status === "needs_review" ? 2 : 0)), 2, "$500.000"])
    expect(table.rows[1]![0]).toBe("noviembre 2026 (en curso)")
  })
})

const dte = (periodo: string, link: string, count: number, amount = 0): DteCoverageRow => ({ periodo, link, count, amount })

describe("shapeDteCoverage", () => {
  const months = reconciliationMonths("2026-11-03", 3)
  const shaped = shapeDteCoverage(
    [dte("2026-09", "oc", 30, 3_000_000), dte("2026-10", "none", 8, 800_000), dte("2026-10", "oc", 40, 4_000_000), dte("2026-11", "combustible", 5, 90_000), dte("2026-01", "oc", 99)],
    months,
    "2026-11-03",
  )

  it("reparte cada período en vinculado a OC, a combustible y sin vincular", () => {
    expect(shaped.months.map((month) => [month.counts.oc, month.counts.combustible, month.counts.none])).toEqual([[30, 0, 0], [40, 0, 8], [0, 5, 0]])
    expect(shaped.months.map((month) => month.partial)).toEqual([false, false, true])
  })

  it("los totales sólo cuentan la ventana", () => {
    expect(shaped.total).toBe(83)
    expect(shaped.byLink.none).toEqual({ count: 8, amount: 800_000 })
    expect(shaped.byLink.oc.count).toBe(70)
  })

  it("los montos suman las notas de crédito como negativos, sin tocarlas", () => {
    const net = shapeDteCoverage([dte("2026-10", "oc", 2, 1_000), dte("2026-10", "oc", 1, -400)], months, "2026-11-03")
    expect(net.byLink.oc.amount).toBe(600)
  })
})

describe("dteCoverageSummary", () => {
  const months = reconciliationMonths("2026-11-03", 3)

  it("con n suficiente da la tasa con su n", () => {
    const shaped = shapeDteCoverage([dte("2026-10", "oc", 40, 1), dte("2026-10", "none", 10, 2_500_000)], months, "2026-11-03")
    expect(dteCoverageSummary(shaped, 3)).toBe(
      "10 de 50 DTE (20%) de los últimos 3 meses no están vinculados a una OC ni a una carga de combustible, por $2.500.000.",
    )
  })

  it("con pocos documentos no da un porcentaje: datos insuficientes, con el n", () => {
    const shaped = shapeDteCoverage([dte("2026-10", "oc", 3), dte("2026-10", "none", 2, 90_000)], months, "2026-11-03")
    const text = dteCoverageSummary(shaped, 3)!
    expect(text).toContain("2 de 5 DTE")
    expect(text).toContain("datos insuficientes para un porcentaje")
    expect(text).not.toContain("%")
  })

  it("si todo está vinculado lo dice", () => {
    const shaped = shapeDteCoverage([dte("2026-10", "oc", 12)], months, "2026-11-03")
    expect(dteCoverageSummary(shaped, 3)).toBe("Los 12 DTE de los últimos 3 meses están vinculados a una OC o a una carga de combustible.")
  })

  it("sin documentos no hay frase", () => {
    expect(dteCoverageSummary(shapeDteCoverage([], months, "2026-11-03"), 3)).toBeNull()
  })

  it("un DTE solo concuerda en singular", () => {
    const shaped = shapeDteCoverage([dte("2026-10", "none", 1, 1000)], months, "2026-11-03")
    expect(dteCoverageSummary(shaped, 3)).toContain("El único DTE")
  })
})

describe("dteListHref, color y tabla", () => {
  it("cada barra lleva a la lista del mismo período y vínculo (el universo es el de la tabla)", () => {
    expect(dteListHref("2026-10", "none")).toBe("/compras/dte?periodo=2026-10&vinculo=sin_oc")
    expect(dteListHref("2026-10", "oc")).toBe("/compras/dte?periodo=2026-10&vinculo=oc")
    expect(dteListHref("2026-10", "combustible")).toBe("/compras/dte?periodo=2026-10&vinculo=combustible")
  })

  it("los vínculos vecinos no comparten color", () => {
    const colors = DTE_LINK_ORDER.map((link) => dteLinkColor(link))
    colors.slice(1).forEach((color, index) => expect(color).not.toBe(colors[index]))
  })

  it("«Ver datos» da cantidad y monto por vínculo en cada período", () => {
    const shaped = shapeDteCoverage([dte("2026-10", "none", 8, 800_000)], reconciliationMonths("2026-11-03", 2), "2026-11-03")
    const table = dteCoverageTable(shaped)
    expect(table.headers).toEqual(["Período", "A OC", "A combustible", "Sin vincular", "Total", "Monto sin vincular"])
    expect(table.rows[0]).toEqual(["octubre 2026", 0, 0, 8, 8, "$800.000"])
  })
})
