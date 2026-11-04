// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// Lo que recibe cada pieza de recharts, para comprobar el contrato de los datos y del texto sin dibujar SVG.
const captured = vi.hoisted(() => ({
  chartData: undefined as unknown,
  areas: {} as Record<string, Record<string, unknown>>,
  yAxes: {} as Record<string, Record<string, unknown>>,
  tooltip: {} as Record<string, unknown>,
  legend: {} as Record<string, unknown>,
}))

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
  AreaChart: ({ children, data }: { children: React.ReactNode; data?: unknown }) => {
    captured.chartData = data
    return <div data-testid="area-chart">{children}</div>
  },
  Area: (props: { dataKey: string; name?: string }) => {
    captured.areas[props.dataKey] = props
    return <div data-testid={`area-${props.dataKey}`}>{props.name}</div>
  },
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ dataKey, name, children }: { dataKey: string; name?: string; children?: React.ReactNode }) => (
    <div data-testid={`bar-${dataKey}`}>
      {name}
      {children}
    </div>
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: (props: { yAxisId?: string }) => {
    if (props.yAxisId) captured.yAxes[props.yAxisId] = props
    return <div data-testid="y-axis" />
  },
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: (props: Record<string, unknown>) => {
    captured.tooltip = props
    return <div data-testid="tooltip" />
  },
  Legend: (props: Record<string, unknown>) => {
    captured.legend = props
    return <div data-testid="legend" />
  },
}))

import { CategoryBarChart, MonthlyEvolutionChart } from "./fuel-charts"

afterEach(() => cleanup())

describe("fuel charts", () => {
  it("renders a single spend bar for category charts (liters live in the tooltip)", () => {
    render(
      <CategoryBarChart
        title="Faenas"
        data={[
          { group: "Faena Norte", totalAmount: 100_000, totalLiters: 240 },
        ]}
      />,
    )

    // Una sola barra ("value"), con el gasto como métrica y los litros en el
    // tooltip: la serie de litros dejó de tener barra propia.
    expect(screen.getByTestId("bar-value")).toBeInTheDocument()
    expect(screen.queryByTestId("bar-litros")).not.toBeInTheDocument()
    expect(screen.queryByTestId("bar-monto")).not.toBeInTheDocument()
  })

  describe("evolución mensual", () => {
    type LegendFormatter = (value: string) => React.ReactElement<{ style: { color: string }; children: React.ReactNode }>
    const MONTHS = [
      { group: "2026-08", totalLiters: 1_000, totalAmount: 1_100_000 },
      { group: "2026-09", totalLiters: 0, totalAmount: 0 },
      { group: "2026-10", totalLiters: 2_000, totalAmount: 2_300_000 },
    ]
    type Point = { month: string; precio: number | null }
    type TooltipFormatter = (value: unknown, name: unknown) => [string, string]

    it("un mes sin litros no tiene precio: queda un hueco, no un 0 que desploma la línea", () => {
      render(<MonthlyEvolutionChart data={MONTHS} />)
      const points = captured.chartData as Point[]
      expect(points.map((p) => p.precio)).toEqual([1_100, null, 1_150])
      // `connectNulls` uniría los meses vecinos por encima del hueco y fingiría un precio que no existió.
      expect(captured.areas.precio!.connectNulls).toBeFalsy()
    })

    it("el tooltip sigue mostrando el mes sin litros y lo dice con palabras en vez de «$0/L»", () => {
      render(<MonthlyEvolutionChart data={MONTHS} />)
      // recharts descarta por defecto las series nulas del tooltip: sin esto el precio simplemente desaparecía.
      expect(captured.tooltip.filterNull).toBe(false)
      const formatter = captured.tooltip.formatter as TooltipFormatter
      expect(formatter(null, "precio")).toEqual(["Sin litros", "Precio prom."])
      expect(formatter(undefined, "precio")).toEqual(["Sin litros", "Precio prom."])
      expect(formatter(1_150, "precio")).toEqual(["$1.150/L", "Precio prom."])
      expect(formatter(2_300_000, "monto")[1]).toBe("Monto CLP")
    })

    it("el texto de los ejes usa los tokens -ink (AA) y las series conservan el color base", () => {
      render(<MonthlyEvolutionChart data={MONTHS} />)
      expect((captured.yAxes.amount!.tick as { fill: string }).fill).toBe("var(--color-info-ink)")
      expect((captured.yAxes.price!.tick as { fill: string }).fill).toBe("var(--color-signal-ink)")
      expect(captured.areas.monto!.stroke).toBe("var(--color-info)")
      expect(captured.areas.precio!.stroke).toBe("var(--color-signal)")
    })

    it("el texto de la leyenda y del tooltip también usa tokens -ink o neutros: recharts los pinta con el color de la serie, y el naranja base mide ~2,5:1", () => {
      render(<MonthlyEvolutionChart data={MONTHS} />)
      // La leyenda conserva el trazo con el color de la serie (el ícono) pero su texto va en la variante -ink de ese mismo matiz,
      // el mismo que ya tiene su eje: así se relaciona cada serie con su eje.
      const formatter = captured.legend.formatter as LegendFormatter
      expect(formatter("Monto CLP").props.style.color).toBe("var(--color-info-ink)")
      expect(formatter("Precio").props.style.color).toBe("var(--color-signal-ink)")
      expect(formatter("Monto CLP").props.children).toBe("Monto CLP")
      // El tooltip pinta cada fila con el color de su serie; una sola regla para todas, en el color del texto.
      expect(captured.tooltip.itemStyle).toEqual({ color: "var(--color-text)" })
    })
  })
})
