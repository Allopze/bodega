// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MaintenanceWorkSummary, FindingsWithoutWork } from "@/lib/services/mantencion/maintenance-work"

vi.mock("@/components/charts/bar-ranking-chart-lazy", () => ({
  BarRankingChartLazy: (props: { ariaLabel: string; items: Array<{ key: string; label: string; value: number; href?: string }> }) => (
    <div role="img" aria-label={`${props.ariaLabel}; «Ver datos» trae las cifras exactas`}>
      <ul>
        {props.items.map((item) => (
          <li key={item.key}>{item.href ? <a href={item.href}>{item.label}</a> : item.label}: {item.value}</li>
        ))}
      </ul>
    </div>
  ),
}))
vi.mock("./indicators-charts-lazy", () => ({
  WorkTypeChart: (props: { source: string; scopeNote: string }) => <div data-testid="chart-type" data-source={props.source} data-note={props.scopeNote} />,
}))
vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { FormsIndicatorsSection, MaintenanceWorkSection } from "./trinorma-sections"

afterEach(cleanup)

const common = {
  from: "2026-10-01",
  to: "2026-10-31",
  granularity: "day" as const,
  chart: { from: "2026-05-01", to: "2026-10-31", granularity: "month" as const, isHistory: true },
  chartNote: "Últimos 6 meses, hasta octubre de 2026 · todas las faenas",
  worksiteId: null,
  scopeNote: "01-10-2026 al 31-10-2026 · todas las faenas",
  canExport: false,
  baseParams: { desde: "2026-10-01", hasta: "2026-10-31" } as Record<string, string | undefined>,
  equipment: null,
}

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
  byWorksite: [
    { key: "ws-a", name: "Faena A", worksiteId: "ws-a", count: 7, correctives: 2, workshopDays: 15, laborHours: 10 },
    { key: "ws-b", name: "Faena B", worksiteId: "ws-b", count: 2, correctives: 1, workshopDays: 0, laborHours: 10 },
  ],
  topCorrective: [{ vehicleId: "v-1", label: "KA-1 · AAAA-01", count: 3 }],
  ...over,
})

const findings = (over: Partial<FindingsWithoutWork> = {}): FindingsWithoutWork => ({ days: 7, total: 6, withWork: 2, withoutWork: 3, inWindow: 1, unlinked: 1, byEquipment: [], ...over })

describe("Trabajos de mantención", () => {
  it("la tira dice el % de correctivas con los «sin clasificar» aparte y de dónde sale cada cifra", () => {
    render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders />)
    const region = screen.getByRole("region", { name: "Trabajos de mantención" })
    expect(within(region).getByText(/^44\s?%$/)).toBeTruthy()
    expect(within(region).getByText(/4 de 9 clasificados · 1 sin clasificar aparte/)).toBeTruthy()
    expect(within(region).getByText("7 del historial · 3 de OT · 2 registros")).toBeTruthy()
    // Los días en taller dicen cuántos trabajos no traen fechas: no son un total «completo».
    expect(within(region).getByText(/3 trabajos con fechas · 7 sin ellas · 1 en taller hoy/)).toBeTruthy()
    // La fuente va rotulada en el gráfico.
    expect(screen.getByTestId("chart-type").getAttribute("data-source")).toMatch(/historial de formularios \(hasta el 30-11-2026\), órdenes de trabajo y registros de la plataforma \(desde el 01-12-2026\)/)
  })

  it("la tira de trabajos no es un enlace (suma tres fuentes que ninguna lista reproduce) y la sección define el corte", () => {
    render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders />)
    const region = screen.getByRole("region", { name: "Trabajos de mantención" })
    expect(within(region).queryByRole("link", { name: /Trabajos del período/ })).toBeNull()
    expect(within(region).getByText("Hasta el 30-11-2026 cuentan los formularios; desde el 01-12-2026, los registros firmados en la plataforma. Las OT cuentan cuando entran a taller.")).toBeTruthy()
  })

  it("omite del subtítulo las fuentes en cero, y sin OT visibles no nombra las OT", () => {
    const { rerender } = render(<MaintenanceWorkSection {...common} summary={summary({ bySource: { historial: 10, ot: 0, registro: 0 } })} includesOrders />)
    expect(screen.getByText("10 del historial")).toBeTruthy()
    rerender(<MaintenanceWorkSection {...common} summary={summary({ bySource: { historial: 0, ot: 4, registro: 1 } })} includesOrders={false} />)
    expect(screen.getByText("1 registro")).toBeTruthy()
  })

  it("el enlace al historial lleva el período y la faena elegida (y omite la faena si no hay una)", () => {
    const { rerender } = render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders />)
    expect(screen.getByRole("link", { name: "Historial de formularios" }).getAttribute("href")).toBe("/mantencion/registros/historicos?desde=2026-10-01&hasta=2026-10-31")
    rerender(<MaintenanceWorkSection {...common} worksiteId="ws-a" summary={summary()} includesOrders />)
    expect(screen.getByRole("link", { name: "Historial de formularios" }).getAttribute("href")).toBe("/mantencion/registros/historicos?desde=2026-10-01&hasta=2026-10-31&faena=ws-a")
  })

  it("el titular de «Días en taller por faena» nombra la faena con más días y no repite el total de la tira", () => {
    render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders />)
    expect(screen.getByText(/días en taller en Faena A, la faena con más/)).toBeTruthy()
  })

  it("sin permiso de órdenes la fuente lo dice y no hay enlace a las OT", () => {
    render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders={false} />)
    expect(screen.getByTestId("chart-type").getAttribute("data-source")).toMatch(/tu perfil no ve todas las órdenes de trabajo de su alcance/)
    expect(screen.queryByRole("link", { name: "Órdenes de trabajo" })).toBeNull()
  })

  it("sin trabajos clasificados dice «Sin dato», no 0 %", () => {
    render(<MaintenanceWorkSection {...common} summary={summary({ correctivePercent: null, classified: 0, byType: { preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 10 } })} includesOrders />)
    const stat = screen.getByRole("region", { name: "Trabajos de mantención" })
    expect(within(stat).getByText("Sin dato")).toBeTruthy()
    expect(within(stat).getByText(/Ningún trabajo clasificado por tipo · 10 sin clasificar/)).toBeTruthy()
  })

  it("los gráficos por faena llevan a esa faena y los equipos con más correctivas, al equipo (Chome → faena → equipo)", () => {
    render(<MaintenanceWorkSection {...common} summary={summary()} includesOrders />)
    expect(screen.getAllByRole("link", { name: "Faena A" })[0]!.getAttribute("href")).toBe("/mantencion/panel?desde=2026-10-01&hasta=2026-10-31&faena=ws-a")
    expect(screen.getAllByRole("link", { name: "KA-1 · AAAA-01" })[0]!.getAttribute("href")).toBe("/mantencion/panel?desde=2026-10-01&hasta=2026-10-31&equipo=v-1")
    // Los días en taller sólo listan faenas con días: Faena B (0) no aparece en ese gráfico.
    const days = screen.getByRole("img", { name: /Días en taller por faena/ })
    expect(within(days).queryByText(/Faena B/)).toBeNull()
  })

  it("con un equipo elegido enlaza a su hoja de vida y no repite el reparto por faena", () => {
    render(<MaintenanceWorkSection {...common} equipment={{ id: "v-1", code: "KA-1", plate: "AAAA-01", worksiteId: "ws-a", label: "KA-1 · AAAA-01" }} summary={summary()} includesOrders />)
    expect(screen.getByRole("link", { name: "Hoja de vida del equipo" }).getAttribute("href")).toBe("/flota/v-1/mantencion")
    expect(screen.queryByRole("img", { name: /Días en taller por faena/ })).toBeNull()
  })

  it("sin trabajos muestra un vacío con su salida, y sin datos (consulta caída) no se pinta", () => {
    const { container, rerender } = render(
      <MaintenanceWorkSection {...common} summary={summary({ total: 0, series: [{ key: "2026-10", partial: false, preventiva: 0, correctiva: 0, predictiva: 0, sin_clasificar: 0 }] })} includesOrders />,
    )
    expect(screen.getByText("No hay trabajos de mantención en este período")).toBeTruthy()
    rerender(<MaintenanceWorkSection {...common} summary={null} includesOrders />)
    expect(container.textContent).toBe("")
  })
})

describe("Pautas y hallazgos de formularios", () => {
  it("«Sin pauta definida» no se repite aquí: vive en el semáforo de la sección de pautas (una dimensión, una representación)", () => {
    render(<FormsIndicatorsSection {...common} compliance={{ checks: 4, withCompliance: 3, averagePercent: 76.7 }} findings={findings()} />)
    expect(screen.getByRole("region", { name: "Pautas y hallazgos de formularios" }).textContent).not.toMatch(/Sin pauta/)
  })

  it("el cumplimiento importado va rotulado «Checklist de pauta (formularios)» y aclara que no es el semáforo", () => {
    render(<FormsIndicatorsSection {...common} compliance={{ checks: 4, withCompliance: 3, averagePercent: 76.7 }} findings={findings()} />)
    const region = screen.getByRole("region", { name: "Pautas y hallazgos de formularios" })
    expect(within(region).getByText("Checklist de pauta (formularios)")).toBeTruthy()
    expect(within(region).getByText(/Promedio de 3 pautas importadas · no es el semáforo de la plataforma/)).toBeTruthy()
  })

  it("los hallazgos sin trabajo dicen el plazo, lo que aún corre y lo que no se pudo evaluar; la lista va por equipo", () => {
    render(
      <FormsIndicatorsSection
        {...common}
       
        compliance={null}
        findings={findings({ byEquipment: [{ vehicleId: "v-2", label: "KA-2 · AAAA-02", worksiteName: "Faena A", count: 2, firstFoundOn: "2026-10-12", items: ["Frenos: Freno de servicio"] }] })}
      />,
    )
    const region = screen.getByRole("region", { name: "Pautas y hallazgos de formularios" })
    expect(within(region).getByText(/de 6 hallazgos del período; sin trabajo ni OT registrados en 7 días · 1 aún dentro del plazo · 1 sin equipo vinculado/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "KA-2 · AAAA-02" }).getAttribute("href")).toBe("/mantencion/panel?desde=2026-10-01&hasta=2026-10-31&equipo=v-2")
    // Una consulta caída se dice «Sin dato», no cero.
    expect(within(region).getAllByText("Sin dato").length).toBeGreaterThan(0)
  })

  it("sin hallazgos sin trabajo dice «Ninguno»", () => {
    render(<FormsIndicatorsSection {...common} compliance={null} findings={findings({ withoutWork: 0 })} />)
    const region = screen.getByRole("region", { name: "Pautas y hallazgos de formularios" })
    expect(within(region).getAllByText("Ninguno")).toHaveLength(1)
  })
})
