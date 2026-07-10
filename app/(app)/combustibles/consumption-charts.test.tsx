// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const mockPush = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams("desde=2026-06-01&hasta=2026-06-30&page=3"),
}))

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: ({ children, onClick }: { children?: React.ReactNode; onClick?: (entry: unknown) => void }) => (
    <button type="button" data-testid="chart-bar" onClick={() => onClick?.({ payload: { filterPatente: "ABCD12" } })}>{children}</button>
  ),
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

import { PatenteRankingChart } from "./consumption-charts"

afterEach(() => {
  cleanup()
  mockPush.mockReset()
})

describe("PatenteRankingChart", () => {
  it("opens the filtered detail and preserves the current date context", () => {
    render(
      <PatenteRankingChart
        metric="monto"
        data={[{ patente: "ABCD12", cantidad: 320, monto: 120_000, transacciones: 4, vehicleId: "veh-1" }]}
      />,
    )

    fireEvent.click(screen.getByTestId("chart-bar"))

    expect(mockPush).toHaveBeenCalledWith("/combustibles?desde=2026-06-01&hasta=2026-06-30&patente=ABCD12")
  })
})
