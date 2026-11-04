// @vitest-environment jsdom
/**
 * «Tendencia mensual de gasto»: cada mes es un punto y se une con rectas. Una curva suavizada
 * (`monotone`) dibuja valores entre dos meses que no existen, y junto a un mes sin datos del proveedor
 * de combustible suaviza justo el hueco que la capa debe mostrar. El test lee la prop `type` que el
 * componente entrega a cada `<Area>`: jsdom no mide, así que no hay trazado que inspeccionar.
 */
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

const captured = vi.hoisted(() => ({ areas: [] as Array<{ dataKey: string; type?: string }> }))

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
    Area: (props: { dataKey: string; type?: string }) => {
      captured.areas.push({ dataKey: props.dataKey, type: props.type })
      return null
    },
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
  }
})
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

import type { SpendByMonthRow } from "@/lib/services/analytics"
import { MonthlySpendChart } from "./analytics-charts"

const months: SpendByMonthRow[] = [
  { month: "2026-07", purchasingAmount: 100, fuelAmount: 50, totalAmount: 150, partial: false },
  { month: "2026-08", purchasingAmount: 70, fuelAmount: null, totalAmount: 70, partial: false },
  { month: "2026-09", purchasingAmount: 20, fuelAmount: 30, totalAmount: 50, partial: true },
]

afterEach(() => {
  cleanup()
  captured.areas.length = 0
})

describe("MonthlySpendChart · curva", () => {
  it("une los meses con segmentos rectos (`linear`), en las dos capas", () => {
    render(<MonthlySpendChart data={months} showFuel />)
    expect(captured.areas.map((area) => area.dataKey)).toEqual(["purchasingAmount", "fuelAmount"])
    for (const area of captured.areas) expect(area.type).toBe("linear")
  })

  it("sin la capa de combustible, la de compras sigue en segmentos rectos", () => {
    render(<MonthlySpendChart data={months} showFuel={false} />)
    expect(captured.areas).toEqual([{ dataKey: "purchasingAmount", type: "linear" }])
  })
})
