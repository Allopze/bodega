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
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ data, children }: { data: Array<{ name: string }>; children?: React.ReactNode }) => (
    <div data-testid="pie" data-names={data.map((item) => item.name).join("|")}>
      {children}
    </div>
  ),
  Cell: ({ fill }: { fill?: string }) => <span data-testid="cell" data-fill={fill} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}))

import { CategoryBarChart, ProductPieChart } from "./fuel-charts"

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

    expect(screen.getByTestId("bar-monto")).toBeInTheDocument()
    expect(screen.queryByTestId("bar-litros")).not.toBeInTheDocument()
  })

  it("groups small product slices into Otros", () => {
    render(
      <ProductPieChart
        data={[
          { group: "Diesel", totalAmount: 900_000, totalLiters: 1_000 },
          { group: "BlueMax", totalAmount: 80_000, totalLiters: 90 },
          { group: "Aditivo", totalAmount: 20_000, totalLiters: 10 },
        ]}
      />,
    )

    expect(screen.getByTestId("pie")).toHaveAttribute("data-names", "Diesel|Otros")
  })

  it("uses tokenized chart colors only", () => {
    render(
      <ProductPieChart
        data={[
          { group: "Diesel", totalAmount: 100_000, totalLiters: 100 },
          { group: "BlueMax", totalAmount: 80_000, totalLiters: 80 },
          { group: "Aditivo", totalAmount: 50_000, totalLiters: 50 },
        ]}
      />,
    )

    for (const cell of screen.getAllByTestId("cell")) {
      expect(cell.getAttribute("data-fill")).toMatch(/^var\(--color-/)
    }
  })
})
