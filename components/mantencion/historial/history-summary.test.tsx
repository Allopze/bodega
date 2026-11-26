// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MaintenanceWorkSummary } from "@/lib/services/mantencion/maintenance-work"

vi.mock("@/components/charts/bar-ranking-chart-lazy", () => ({
  BarRankingChartLazy: (props: { ariaLabel: string; items: Array<{ key: string; label: string; value: number; href?: string }> }) => (
    <div role="img" aria-label={props.ariaLabel}>
      <ul>
        {props.items.map((item) => (
          <li key={item.key}>{item.href ? <a href={item.href}>{item.label}</a> : item.label}: {item.value}</li>
        ))}
      </ul>
    </div>
  ),
}))
vi.mock("@/app/(app)/mantencion/panel/indicators-charts-lazy", () => ({
  WorkTypeChart: (props: { data: unknown[]; granularity: string; source: string; scopeNote: string; excel?: unknown }) => (
    <div
      data-testid="chart-type"
      data-granularity={props.granularity}
      data-source={props.source}
      data-note={props.scopeNote}
      data-points={props.data.length}
      data-excel={props.excel ? "si" : "no"}
    />
  ),
}))
vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { HistorySummary } from "./history-summary"

afterEach(cleanup)

const params = parseHistoryParams({}, "2026-11-25")
const NOTE = "Todas las faenas"

const summary = (over: Partial<MaintenanceWorkSummary> = {}): MaintenanceWorkSummary => ({
  total: 10,
  byType: { preventiva: 4, correctiva: 4, predictiva: 1, sin_clasificar: 1 },
  classified: 9,
  correctivePercent: (4 / 9) * 100,
  bySource: { historial: 7, ot: 3, registro: 2 },
  workshopDays: { total: 15, withData: 3, withoutData: 7, inWorkshop: 1 },
  laborHours: { total: 20, withData: 3, withoutData: 7 },
  external: 1,
  series: [{ key: "2026-10", partial: false, preventiva: 4, correctiva: 4, predictiva: 1, sin_clasificar: 1 }],
  byWorksite: [],
  topCorrective: [
    { vehicleId: "v-1", label: "KA-1 · AAAA-01", count: 3 },
    { vehicleId: "v-2", label: "KA-2 · AAAA-02", count: 2 },
  ],
  ...over,
})

const zeroSeries = [{ key: "2026-10", partial: false, preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 0 }]

describe("Resumen del historial de mantenciones", () => {
  it("la tira dice trabajos, horas y días en taller, y «N sin dato» donde algún trabajo no trae el dato", () => {
    render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    const region = screen.getByRole("region", { name: "Resumen del historial" })
    expect(within(region).getByText("Trabajos")).toBeTruthy()
    expect(within(region).getByText("10")).toBeTruthy()
    expect(within(region).getByText("Horas hombre")).toBeTruthy()
    expect(within(region).getByText("20")).toBeTruthy()
    expect(within(region).getByText("Días en taller")).toBeTruthy()
    expect(within(region).getByText("15")).toBeTruthy()
    // Horas y días tienen cada uno 7 trabajos sin dato.
    expect(within(region).getAllByText("7 sin dato")).toHaveLength(2)
  })

  it("sin ningún dato de horas ni de días dice «Sin dato», no un cero", () => {
    render(
      <HistorySummary
        summary={summary({
          laborHours: { total: 0, withData: 0, withoutData: 10 },
          workshopDays: { total: 0, withData: 0, withoutData: 10, inWorkshop: 0 },
        })}
        params={params}
        scopeNote={NOTE}
        includesOrders
      />,
    )
    const region = screen.getByRole("region", { name: "Resumen del historial" })
    expect(within(region).getAllByText("Sin dato")).toHaveLength(2)
    expect(within(region).getAllByText("10 sin dato")).toHaveLength(2)
    expect(within(region).queryByText("0")).toBeNull()
  })

  it("cada equipo del ranking enlaza al historial filtrado por ese equipo, conservando los filtros de la vista", () => {
    const filtered = parseHistoryParams({ faena: "ws-a", tipo: "correctiva" }, "2026-11-25")
    render(<HistorySummary summary={summary()} params={filtered} scopeNote={NOTE} includesOrders />)
    expect(screen.getByRole("link", { name: "KA-1 · AAAA-01" }).getAttribute("href")).toBe("/mantencion/registros/historicos?equipo=v-1&faena=ws-a&tipo=correctiva")
    expect(screen.getByRole("link", { name: "KA-2 · AAAA-02" }).getAttribute("href")).toBe("/mantencion/registros/historicos?equipo=v-2&faena=ws-a&tipo=correctiva")
  })

  it("el enlace del equipo va a la vista Historial aunque la página esté en otra vista", () => {
    const matrix = parseHistoryParams({ vista: "matriz" }, "2026-11-25")
    render(<HistorySummary summary={summary()} params={matrix} scopeNote={NOTE} includesOrders />)
    expect(screen.getByRole("link", { name: "KA-1 · AAAA-01" }).getAttribute("href")).toBe("/mantencion/registros/historicos?equipo=v-1")
  })

  it("sin trabajos ni serie no pinta nada: la página muestra su propio estado vacío", () => {
    const empty = summary({
      total: 0,
      byType: { preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 0 },
      classified: 0,
      correctivePercent: null,
      laborHours: { total: 0, withData: 0, withoutData: 0 },
      workshopDays: { total: 0, withData: 0, withoutData: 0, inWorkshop: 0 },
      series: zeroSeries,
      topCorrective: [],
    })
    const { container } = render(<HistorySummary summary={empty} params={params} scopeNote={NOTE} includesOrders />)
    expect(container.innerHTML).toBe("")
  })

  it("sin permiso para ver órdenes lo dice en una línea; con permiso no aparece", () => {
    const { rerender } = render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders={false} />)
    expect(screen.getByText("Tu perfil no ve todas las órdenes de trabajo: las cifras son de formularios y registros.")).toBeTruthy()
    rerender(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.queryByText(/Tu perfil no ve todas las órdenes de trabajo/)).toBeNull()
  })

  it("con el gráfico por tipo, el % de correctivas no se repite en una línea de apoyo (A5)", () => {
    render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.queryByText(/^Correctivas:/)).toBeNull()
  })

  it("sin gráfico por tipo, la línea de apoyo dice el % con los clasificados y los «sin clasificar» aparte", () => {
    render(<HistorySummary summary={summary({ series: zeroSeries })} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.getByText("Correctivas: 44% de los trabajos clasificados (4 de 9) · 1 sin clasificar aparte")).toBeTruthy()
  })

  it("sin trabajos clasificados por tipo dice «Sin dato», no 0 %", () => {
    render(
      <HistorySummary
        summary={summary({ series: zeroSeries, correctivePercent: null, classified: 0, byType: { preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 10 } })}
        params={params}
        scopeNote={NOTE}
        includesOrders
      />,
    )
    expect(screen.getByText("Correctivas: Sin dato · ningún trabajo clasificado por tipo · 10 sin clasificar aparte")).toBeTruthy()
    expect(screen.queryByText(/0%/)).toBeNull()
  })

  it("los gráficos van en un bloque plegable, abierto por defecto", () => {
    const { container } = render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    const details = container.querySelector("details")
    expect(details?.hasAttribute("open")).toBe(true)
    expect(within(details as HTMLElement).getByText("Gráficos del período")).toBeTruthy()
    expect(within(details as HTMLElement).getByTestId("chart-type")).toBeTruthy()
  })

  it("el gráfico por tipo recibe la serie mensual, su alcance y la fuente con las fechas del corte, y no trae descarga", () => {
    render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    const chart = screen.getByTestId("chart-type")
    expect(chart.getAttribute("data-granularity")).toBe("month")
    expect(chart.getAttribute("data-points")).toBe("1")
    expect(chart.getAttribute("data-note")).toBe(NOTE)
    expect(chart.getAttribute("data-source")).toBe("formularios (hasta el 30-11-2026), órdenes de trabajo y registros firmados (desde el 01-12-2026)")
    // La descarga exige el permiso de exportar, que este componente no recibe: sin `excel` no hay botón.
    expect(chart.getAttribute("data-excel")).toBe("no")
  })

  it("sin permiso de órdenes la fuente del gráfico no las nombra", () => {
    render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders={false} />)
    expect(screen.getByTestId("chart-type").getAttribute("data-source")).toBe("formularios (hasta el 30-11-2026) y registros firmados (desde el 01-12-2026)")
  })

  it("filtrado por origen, la fuente es sólo ese origen", () => {
    const onlyForms = parseHistoryParams({ origen: "historial" }, "2026-11-25")
    render(<HistorySummary summary={summary()} params={onlyForms} scopeNote={NOTE} includesOrders />)
    expect(screen.getByTestId("chart-type").getAttribute("data-source")).toBe("formularios (hasta el 30-11-2026)")
  })

  it("sin serie por tipo el gráfico no se dibuja, pero el ranking sigue", () => {
    render(<HistorySummary summary={summary({ series: zeroSeries })} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.queryByTestId("chart-type")).toBeNull()
    expect(screen.getByRole("img", { name: "Equipos con más trabajos correctivos" })).toBeTruthy()
  })

  it("el ranking titula al equipo con más correctivas y, con empate, dice cuántos equipos empatan", () => {
    const { rerender } = render(<HistorySummary summary={summary()} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.getByText("correctivas en KA-1 · AAAA-01, el equipo con más")).toBeTruthy()
    expect(screen.getByText(/sólo equipos con 2 o más/)).toBeTruthy()
    rerender(
      <HistorySummary
        summary={summary({ topCorrective: [{ vehicleId: "v-1", label: "KA-1 · AAAA-01", count: 3 }, { vehicleId: "v-2", label: "KA-2 · AAAA-02", count: 3 }] })}
        params={params}
        scopeNote={NOTE}
        includesOrders
      />,
    )
    expect(screen.getByText("equipos empatan con 3 correctivas")).toBeTruthy()
  })

  it("sin equipos con dos o más correctivas no hay ranking", () => {
    render(<HistorySummary summary={summary({ topCorrective: [] })} params={params} scopeNote={NOTE} includesOrders />)
    expect(screen.queryByRole("img", { name: "Equipos con más trabajos correctivos" })).toBeNull()
    expect(screen.queryByText("Equipos con más correctivas")).toBeNull()
  })
})
