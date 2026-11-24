// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { ReportsPerDayChart } from "./reporte-equipos-charts"

const scopeNote = "01-11-2026 al 13-11-2026 · todas las faenas"

describe("ReportsPerDayChart", () => {
  it("el título dice la unidad del período: «por día» con granularidad diaria", () => {
    render(
      <ReportsPerDayChart
        granularity="day"
        scopeNote={scopeNote}
        data={[
          { key: "2026-11-10", partial: false, expected: 5, received: 4 },
          { key: "2026-11-11", partial: true, expected: 5, received: 5 },
        ]}
      />,
    )
    expect(screen.getByRole("heading", { name: "Reportes recibidos por día" })).toBeTruthy()
  })

  it("con granularidad mensual dice «por mes» (antes decía «por día» siempre)", () => {
    render(
      <ReportsPerDayChart
        granularity="month"
        scopeNote={scopeNote}
        data={[
          { key: "2026-09", partial: false, expected: 40, received: 31 },
          { key: "2026-10", partial: false, expected: 42, received: 40 },
        ]}
      />,
    )
    expect(screen.getByRole("heading", { name: "Reportes recibidos por mes" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Reportes recibidos por día" })).toBeNull()
  })
})
