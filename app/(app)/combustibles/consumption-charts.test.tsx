// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const mockPush = vi.hoisted(() => vi.fn())
const mockReplace = vi.hoisted(() => vi.fn())
const mockClickedVehicle = vi.hoisted(() => ({ current: null as string | null }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams("desde=2026-06-01&hasta=2026-06-30&faena=f1&page=3&patente=OTRA"),
}))

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: ({ children, onClick }: { children?: React.ReactNode; onClick?: (entry: unknown) => void }) => (
    <button type="button" data-testid="chart-bar" onClick={() => onClick?.({ payload: { filterPatente: "ABCD12", vehicleId: mockClickedVehicle.current } })}>{children}</button>
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
  mockReplace.mockReset()
  mockClickedVehicle.current = null
})

describe("PatenteRankingChart", () => {
  it("una patente que es un equipo abre su ficha con el período y la faena que se miran", () => {
    mockClickedVehicle.current = "veh-1"
    render(
      <PatenteRankingChart
        metric="monto"
        data={[{ patente: "ABCD12", cantidad: 320, monto: 120_000, transacciones: 4, vehicleId: "veh-1" }]}
      />,
    )

    fireEvent.click(screen.getByTestId("chart-bar"))

    expect(mockPush).toHaveBeenCalledWith("/combustibles/consumo/equipos/veh-1?desde=2026-06-01&hasta=2026-06-30&faena=f1")
  })

  it("una patente que no es un equipo filtra el análisis de tarjetas, sin arrastrar la página ni la patente anterior", () => {
    render(
      <PatenteRankingChart
        metric="cantidad"
        data={[{ patente: "ABCD12", cantidad: 320, monto: null, transacciones: 4, vehicleId: null }]}
      />,
    )

    fireEvent.click(screen.getByTestId("chart-bar"))

    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith("/combustibles/consumo/litros?desde=2026-06-01&hasta=2026-06-30&faena=f1&patente=ABCD12&seccion=tarjetas", { scroll: false })
  })
})
