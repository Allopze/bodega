// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

// recharts dibuja SVG con medidas reales; aquí sólo importa qué series se montan
// (la leyenda de recharts lista exactamente las `<Bar>` que recibe).
const captured = vi.hoisted(() => ({ bars: [] as Array<{ dataKey: string; fill: string }> }))

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Bar: (props: { dataKey: string; fill: string }) => {
      captured.bars.push({ dataKey: props.dataKey, fill: props.fill })
      return null
    },
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
    Tooltip: () => null,
  }
})

import {
  RECONCILIATION_STATUS_META,
  RECONCILIATION_STATUS_ORDER,
  reconciliationMonths,
  shapeReconciliationMonths,
  type ReconciliationRow,
} from "@/lib/purchasing/reconciliation-charts"
import { ReconciliationChart } from "./reconciliation-chart"

const TODAY = "2026-10-15"
const months = reconciliationMonths(TODAY, 6)
const row = (month: string, status: string, count: number): ReconciliationRow => ({ month, status, count, toInvoice: 0, withBalance: 0 })

function drawn(rows: ReconciliationRow[]) {
  captured.bars.length = 0
  render(<ReconciliationChart shape={shapeReconciliationMonths(rows, months, TODAY)} />)
  return [...captured.bars]
}

afterEach(() => cleanup())

describe("ReconciliationChart · leyenda", () => {
  it("sólo monta (y por tanto sólo lista en la leyenda) los estados con OC en la ventana", () => {
    const bars = drawn([row("2026-10", "needs_review", 2), row("2026-09", "matched", 4)])
    expect(bars.map((bar) => bar.dataKey)).toEqual(["needs_review", "matched"])
  })

  it("conserva el orden fijo de la pila y el color de cada estado, vengan los datos como vengan", () => {
    const bars = drawn([
      row("2026-10", "matched", 1),
      row("2026-09", "no_invoices", 3),
      row("2026-08", "needs_review", 1),
      row("2026-08", "partially_invoiced", 2),
    ])
    const expected = RECONCILIATION_STATUS_ORDER.filter((status) => ["needs_review", "partially_invoiced", "no_invoices", "matched"].includes(status))
    expect(bars.map((bar) => bar.dataKey)).toEqual(expected)
    for (const bar of bars) expect(bar.fill).toBe(RECONCILIATION_STATUS_META[bar.dataKey as keyof typeof RECONCILIATION_STATUS_META].color)
  })

  it("un estado que sólo tiene OC en un mes de la ventana sí aparece", () => {
    const bars = drawn([row("2026-05", "accepted_exception", 1)])
    expect(bars.map((bar) => bar.dataKey)).toEqual(["accepted_exception"])
  })

  it("con todos los estados presentes monta los seis", () => {
    const bars = drawn(RECONCILIATION_STATUS_ORDER.map((status) => row("2026-10", status, 1)))
    expect(bars.map((bar) => bar.dataKey)).toEqual([...RECONCILIATION_STATUS_ORDER])
  })
})
