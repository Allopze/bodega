// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { bucketFullLabel, OutOfServiceChart, peakOf, RecordsKindChart, WorkOrderFlowChart, WorkOrderMixChart } from "./indicators-charts"

const common = { granularity: "month" as const, scopeNote: "01-09-2026 al 13-11-2026 · todas las faenas" }

describe("gráficos de los Indicadores de mantención", () => {
  it("el flujo de OT dice en qué período se pidió más trabajo (no repite los tiles) y trae su tabla «Ver datos»", () => {
    render(
      <WorkOrderFlowChart
        {...common}
        data={[
          { key: "2026-09", created: 4, closed: 1, backlog: 3, partial: false },
          { key: "2026-10", created: 2, closed: 3, backlog: 2, partial: false },
          { key: "2026-11", created: 1, closed: 0, backlog: 3, partial: true },
        ]}
      />,
    )
    expect(screen.getByRole("heading", { name: "Órdenes de trabajo: creadas, cerradas y en cola" })).toBeTruthy()
    // El titular es el pico de OT creadas (septiembre, 4), no el total en cola ni el de cerradas, que son tiles.
    expect(screen.getByText(/OT creadas en sept 2026, el período con más/)).toBeTruthy()
    expect(screen.queryByText(/en cola hoy/)).toBeNull()
    expect(screen.getByText(/el último mes es parcial/)).toBeTruthy()
    expect(screen.getByText("Ver datos")).toBeTruthy()
    expect(screen.getByRole("table", { hidden: true, name: "Órdenes de trabajo: creadas, cerradas y en cola" })).toBeTruthy()
  })

  it("sin ningún dato cada gráfico devuelve null (su celda se oculta)", () => {
    const empty = [{ key: "2026-11", partial: true }]
    const { container } = render(
      <>
        <WorkOrderFlowChart {...common} data={[{ ...empty[0]!, created: 0, closed: 0, backlog: 0 }]} />
        <WorkOrderMixChart {...common} data={[{ ...empty[0]!, repairOnly: 0, maintenanceOnly: 0, both: 0 }]} />
        <RecordsKindChart {...common} data={[{ ...empty[0]!, preventive: 0, corrective: 0 }]} />
        <OutOfServiceChart {...common} data={[{ ...empty[0]!, days: 0 }]} />
      </>,
    )
    expect(container.innerHTML).toBe("")
  })

  it("la mezcla dice qué parte de las OT creadas son reparaciones (incluye las que son ambas)", () => {
    render(<WorkOrderMixChart {...common} data={[{ key: "2026-10", partial: false, repairOnly: 2, maintenanceOnly: 2, both: 2 }]} />)
    // (2 + 2) de 6.
    expect(screen.getByText("67%")).toBeTruthy()
    expect(screen.getByText(/de las OT creadas son reparaciones \(4 de 6\)/)).toBeTruthy()
  })

  it("registros: el titular es la parte correctiva; días fuera de servicio: el período con más, no el total del tile", () => {
    render(
      <>
        <RecordsKindChart {...common} data={[{ key: "2026-10", partial: false, preventive: 6, corrective: 2 }]} />
        <OutOfServiceChart
          {...common}
          data={[{ key: "2026-09", partial: false, days: 3.4 }, { key: "2026-10", partial: false, days: 12.5 }, { key: "2026-11", partial: true, days: 1 }]}
        />
      </>,
    )
    expect(screen.getByText("25%")).toBeTruthy()
    expect(screen.getByText(/de los registros fueron correctivos \(2 de 8\)/)).toBeTruthy()
    expect(screen.getAllByText("12,5").length).toBeGreaterThan(0)
    expect(screen.getByText(/días-equipo fuera de servicio en oct 2026, el período con más/)).toBeTruthy()
    // La suma (16,9) es la del tile; el gráfico no la repite.
    expect(screen.queryByText("16,9")).toBeNull()
  })

  it("con empate en el pico no se corona a un período", () => {
    render(
      <OutOfServiceChart {...common} data={[{ key: "2026-09", partial: false, days: 5 }, { key: "2026-10", partial: false, days: 5 }, { key: "2026-11", partial: true, days: 1 }]} />,
    )
    expect(screen.getByText(/en cada uno de 2 períodos, el máximo del rango/)).toBeTruthy()
  })

  it("peakOf: devuelve el balde único o cuántos empatan", () => {
    const points = [{ key: "a", partial: false, n: 1 }, { key: "b", partial: false, n: 3 }, { key: "c", partial: false, n: 3 }]
    expect(peakOf(points, (point) => point.n)).toMatchObject({ value: 3, tied: 2, point: null })
    expect(peakOf(points.slice(0, 2), (point) => point.n)).toMatchObject({ value: 3, tied: 1, point: { key: "b" } })
  })

  it("peakOf: el balde en curso no compite, salvo que sea el único", () => {
    const points = [{ key: "oct", partial: false, n: 20 }, { key: "nov", partial: true, n: 50 }]
    expect(peakOf(points, (point) => point.n)).toMatchObject({ value: 20, tied: 1, point: { key: "oct" } })
    expect(peakOf(points.slice(1), (point) => point.n)).toMatchObject({ value: 50, tied: 1, point: { key: "nov" } })
  })

  it("rótulos de balde: el día lleva el año y el mes no repite nada", () => {
    expect(bucketFullLabel("2026-11-03", "day")).toBe("3 nov 2026")
    expect(bucketFullLabel("2026-11", "month")).toBe("nov 2026")
  })
})
