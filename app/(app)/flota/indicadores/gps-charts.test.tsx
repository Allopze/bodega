// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { GpsTripsChart, GpsUsageChart } from "./gps-charts"

/**
 * El titular en reposo de los gráficos GPS (crítica 2026-11-15, paso 5): el mes en curso no
 * compite por «el mes de más recorrido» mientras no supere a los cerrados; cuando ya los supera,
 * se dice, en vez de nombrar un mes cerrado más bajo junto a la barra más alta.
 */
describe("titulares de los gráficos GPS", () => {
  it("el mes en curso que ya supera a los cerrados se dice", () => {
    render(
      <>
        <GpsUsageChart
          granularity="month"
          description="Por mes"
          data={[
            { key: "2026-09", label: "sept 2026", km: 1_000, hours: 0 },
            { key: "2026-10", label: "oct 2026", km: 1_400, hours: 0 },
            { key: "2026-11", label: "nov 2026", km: 2_100, hours: 0, partial: true },
          ]}
        />
        <GpsTripsChart
          granularity="month"
          description="Por mes"
          totalTrips={70}
          data={[
            { key: "2026-10", label: "oct 2026", trips: 30, avgKm: 12 },
            { key: "2026-11", label: "nov 2026", trips: 40, avgKm: 10, partial: true },
          ]}
        />
      </>,
    )
    expect(screen.getByText("km en nov 2026, que sigue en curso y ya supera a todos los meses anteriores del gráfico")).toBeTruthy()
    expect(screen.getByText("viajes en nov 2026, que sigue en curso y ya supera a todos los meses anteriores del gráfico")).toBeTruthy()
  })

  it("mientras no los supere, el titular nombra el mes cerrado con más", () => {
    render(
      <GpsUsageChart
        granularity="month"
        description="Por mes"
        data={[
          { key: "2026-10", label: "oct 2026", km: 1_400, hours: 0 },
          { key: "2026-11", label: "nov 2026", km: 300, hours: 0, partial: true },
        ]}
      />,
    )
    expect(screen.getByText("km en oct 2026, el mes de más recorrido")).toBeTruthy()
    expect(screen.queryByText(/sigue en curso/)).toBeNull()
  })
})
