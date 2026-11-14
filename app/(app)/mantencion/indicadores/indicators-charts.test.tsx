// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { bucketFullLabel, OutOfServiceChart, RecordsKindChart, WorkOrderFlowChart, WorkOrderMixChart } from "./indicators-charts"

const common = { granularity: "month" as const, scopeNote: "01-09-2026 al 13-11-2026 · todas las faenas" }

describe("gráficos de los Indicadores de mantención", () => {
  it("el flujo de OT dice cuántas hay en cola, cuántas se crearon y cerraron, y trae su tabla «Ver datos»", () => {
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
    // En cola hoy (el último período es parcial), con la suma del rango.
    expect(screen.getByText(/OT en cola hoy · 7 creadas y 4 cerradas/)).toBeTruthy()
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

  it("registros y días fuera de servicio dan su cifra en el titular", () => {
    render(
      <>
        <RecordsKindChart {...common} data={[{ key: "2026-10", partial: false, preventive: 5, corrective: 2 }]} />
        <OutOfServiceChart {...common} data={[{ key: "2026-10", partial: false, days: 12.5 }]} />
      </>,
    )
    expect(screen.getByText(/registros preventivos · 2 correctivos/)).toBeTruthy()
    expect(screen.getAllByText("12,5").length).toBeGreaterThan(0)
    expect(screen.getByText(/días-equipo fuera de servicio en el período/)).toBeTruthy()
  })

  it("rótulos de balde: el día lleva el año y el mes no repite nada", () => {
    expect(bucketFullLabel("2026-11-03", "day")).toBe("3 nov 2026")
    expect(bucketFullLabel("2026-11", "month")).toBe("nov 2026")
  })
})
