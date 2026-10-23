// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: ({ dataKey, name }: { dataKey: string; name?: string }) => <div data-testid={`area-${dataKey}`}>{name}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ dataKey, name, children }: { dataKey: string; name?: string; children?: React.ReactNode }) => (
    <div data-testid={`bar-${dataKey}`}>
      {name}
      {children}
    </div>
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}))

import { CategoryBarChart } from "./fuel-charts"

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
})
