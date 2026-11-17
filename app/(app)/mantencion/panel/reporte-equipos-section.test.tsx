// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ReporteEquiposIndicators } from "@/lib/services/mantencion/reporte-equipos"

// Los gráficos de recharts se sustituyen: aquí se mira la estructura de la sección (tira de cifras,
// enlaces, vacíos y qué gráficos se piden), no el dibujo.
vi.mock("@/components/charts/bar-ranking-chart-lazy", () => ({
  BarRankingChartLazy: (props: { ariaLabel: string; unit?: string; order?: string; items: Array<{ key: string; label: string; value: number; href?: string }> }) => (
    <div role="img" aria-label={`${props.ariaLabel}; «Ver datos» trae las cifras exactas`} data-unit={props.unit} data-order={props.order}>
      <ul>
        {props.items.map((item) => (
          <li key={item.key}>
            {item.href ? <a href={item.href}>{item.label}</a> : item.label}: {item.value}
          </li>
        ))}
      </ul>
    </div>
  ),
}))
vi.mock("./reporte-equipos-charts-lazy", () => ({
  ReportsPerDayChart: (props: { granularity: string; scopeNote: string; excel?: { notes?: string[] }; data: unknown[] }) => (
    <div data-testid="chart-por-dia" data-granularity={props.granularity} data-note={props.scopeNote} data-points={props.data.length} data-excel={props.excel ? "si" : "no"} />
  ),
  OpenFailuresAgeChart: (props: { rows: Array<{ label: string; old: number }> }) => (
    <div data-testid="chart-antiguedad" data-rows={props.rows.map((row) => row.label).join("|")} />
  ),
}))
vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { ReporteEquiposSection } from "./reporte-equipos-section"

const common = {
  from: "2026-11-01",
  to: "2026-11-13",
  granularity: "day" as const,
  chart: { from: "2026-06-01", to: "2026-11-13", granularity: "month" as const, isHistory: true },
  chartNote: "Últimos 6 meses, hasta noviembre de 2026 · todas las faenas",
  worksiteId: null,
  scopeNote: "01-11-2026 al 13-11-2026 · todas las faenas",
  canExport: false,
}

function data(over: Partial<ReporteEquiposIndicators> = {}): ReporteEquiposIndicators {
  return {
    hasRuns: true,
    coverage: {
      expected: 20,
      received: 16,
      percent: 80,
      points: [
        { key: "2026-11-12", expected: 10, received: 9, partial: false },
        { key: "2026-11-13", expected: 10, received: 7, partial: true },
      ],
    },
    signatures: { complete: 12, received: 16, percent: 75 },
    hours: {
      total: 120.5,
      measuredReports: 14,
      byEquipment: [
        { vehicleId: "v1", code: "KA-1", plate: "AAAA-01", hours: 80 },
        { vehicleId: "v2", code: "CR-2", plate: "BBBB-02", hours: 40.5 },
      ],
    },
    failures: {
      total: 5,
      safety: 2,
      byEquipment: [
        { key: "v1", vehicleId: "v1", code: "KA-1", plate: "AAAA-01", fresh: 1, week: 1, old: 2, total: 4, safety: 2 },
        { key: "v2", vehicleId: "v2", code: "CR-2", plate: "BBBB-02", fresh: 1, week: 0, old: 0, total: 1, safety: 0 },
      ],
    },
    bySystem: [
      { id: "frenos_direccion", label: "Frenos y dirección", count: 6 },
      { id: "electrico", label: "Eléctrico", count: 3 },
    ],
    ...over,
  }
}

const region = () => screen.getByRole("region", { name: "Reportes de equipos" })
const stripCells = (container: HTMLElement) => [...container.querySelectorAll("[data-pressable]")]

describe("ReporteEquiposSection", () => {
  it("sin datos (consulta caída) o sin ningún reporte en el alcance no pinta nada, ni el marco", () => {
    const failed = render(<ReporteEquiposSection {...common} data={null} canViewInspections />)
    expect(failed.container.innerHTML).toBe("")
    const none = render(<ReporteEquiposSection {...common} data={data({ hasRuns: false })} canViewInspections />)
    expect(none.container.innerHTML).toBe("")
  })

  it("una tira de exactamente cuatro cifras, sin tiles, cada una con su enlace a la bandeja de Inspecciones", () => {
    const { container } = render(<ReporteEquiposSection {...common} data={data()} canViewInspections />)
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    const cells = stripCells(container)
    expect(cells).toHaveLength(4)
    const labels = cells.map((cell) => cell.querySelector(".text-eyebrow")?.textContent)
    expect(labels).toEqual(["Reportes recibidos", "Firmas completas", "Horas operadas", "Fallas abiertas"])
    // Sólo lo que la bandeja entiende: la búsqueda por el nombre de la plantilla y su vista de hallazgos abiertos.
    for (const cell of cells.slice(0, 3)) expect(cell.getAttribute("href")).toBe("/prevencion/inspecciones?q=Reporte+de+Equipos")
    expect(cells[3]!.getAttribute("href")).toBe("/prevencion/inspecciones?q=Reporte+de+Equipos&vista=open_findings")
  })

  it("las cifras: recibidos X de Y, firmas, horas y fallas con las de seguridad", () => {
    const { container } = render(<ReporteEquiposSection {...common} data={data()} canViewInspections />)
    const [recibidos, firmas, horas, fallas] = stripCells(container) as HTMLElement[]
    expect(recibidos!.textContent).toContain("80%")
    expect(recibidos!.textContent).toContain("16 de 20 reportes esperados")
    expect(firmas!.textContent).toContain("75%")
    expect(firmas!.textContent).toContain("12 de 16 reportes recibidos con todas las firmas")
    expect(horas!.textContent).toContain("120,5")
    expect(horas!.textContent).toContain("14 de 16 reportes recibidos")
    expect(fallas!.textContent).toContain("5")
    expect(fallas!.textContent).toContain("2 de seguridad")
  })

  it("un porcentaje con reportes sin llegar nunca se redondea a 100 %", () => {
    const { container } = render(
      <ReporteEquiposSection {...common} data={data({ coverage: { expected: 1000, received: 996, percent: 99.6, points: [] }, signatures: { complete: 996, received: 996, percent: 100 } })} canViewInspections />,
    )
    const [recibidos, firmas] = stripCells(container) as HTMLElement[]
    expect(recibidos!.textContent).toContain("99%")
    expect(firmas!.textContent).toContain("100%")
  })

  it("el filtro de faena viaja a los enlaces", () => {
    const { container } = render(<ReporteEquiposSection {...common} worksiteId="ws-1" data={data()} canViewInspections />)
    for (const cell of stripCells(container)) expect(cell.getAttribute("href")).toContain("faena=ws-1")
    expect(within(region()).getByRole("link", { name: /Reportes en Inspecciones/ }).getAttribute("href")).toBe("/prevencion/inspecciones?q=Reporte+de+Equipos&faena=ws-1")
  })

  it("sin permiso para ver inspecciones las cifras van sin enlace", () => {
    const { container } = render(<ReporteEquiposSection {...common} data={data()} canViewInspections={false} />)
    expect(stripCells(container)).toHaveLength(0)
    expect(container.querySelectorAll(".text-eyebrow")).not.toHaveLength(0)
    expect(within(region()).queryByRole("link", { name: /Reportes en Inspecciones/ })).toBeNull()
    expect(region().textContent).toContain("Reportes recibidos")
    expect(region().textContent).toContain("80%")
  })

  it("pide los cuatro gráficos: por día, horas por equipo, antigüedad de fallas y fallas por sistema", () => {
    render(<ReporteEquiposSection {...common} canExport data={data()} canViewInspections />)
    const perDay = screen.getByTestId("chart-por-dia")
    // Por día va con el período (su granularidad y su pie), no con la ventana de seis meses de los otros gráficos.
    expect(perDay.getAttribute("data-granularity")).toBe("day")
    expect(perDay.getAttribute("data-note")).toBe(common.scopeNote)
    expect(perDay.getAttribute("data-points")).toBe("2")
    // El Excel del tablero recoge la tabla sólo con el permiso de exportar.
    expect(perDay.getAttribute("data-excel")).toBe("si")
    const hours = screen.getByRole("img", { name: /^Horas operadas por equipo/ })
    expect(hours.getAttribute("data-order")).toBe("desc")
    expect(within(hours).getByRole("link", { name: "KA-1 · AAAA-01" }).getAttribute("href")).toContain("/v1")
    expect(screen.getByTestId("chart-antiguedad").getAttribute("data-rows")).toBe("KA-1 · AAAA-01|CR-2 · BBBB-02")
    const systems = screen.getByRole("img", { name: /^Fallas reportadas por sistema/ })
    expect(within(systems).getByText(/Frenos y dirección/)).toBeTruthy()
    // Cada gráfico trae su tabla «Ver datos» para el Excel.
    expect(region().querySelectorAll("details")).toHaveLength(3)
    expect(screen.queryByText(/Disponibilidad/)).toBeNull()
  })

  it("sin permiso de exportar la tabla por día no ofrece Excel", () => {
    render(<ReporteEquiposSection {...common} data={data()} canViewInspections />)
    expect(screen.getByTestId("chart-por-dia").getAttribute("data-excel")).toBe("no")
  })

  it("un gráfico sin datos no se pide: sin horómetros ni fallas quedan sólo los que tienen qué mostrar", () => {
    render(
      <ReporteEquiposSection
        {...common}
        data={data({
          hours: { total: 0, measuredReports: 0, byEquipment: [] },
          failures: { total: 0, safety: 0, byEquipment: [] },
          bySystem: [],
        })}
        canViewInspections
      />,
    )
    expect(screen.getByTestId("chart-por-dia")).toBeTruthy()
    expect(screen.queryByRole("img", { name: /^Horas operadas/ })).toBeNull()
    expect(screen.queryByTestId("chart-antiguedad")).toBeNull()
    expect(screen.queryByRole("img", { name: /^Fallas reportadas/ })).toBeNull()
  })

  it("las cifras vacías dicen qué falta en vez de un cero pelado", () => {
    const { container } = render(
      <ReporteEquiposSection
        {...common}
        data={data({
          signatures: { complete: 0, received: 0, percent: null },
          hours: { total: 0, measuredReports: 0, byEquipment: [] },
          failures: { total: 0, safety: 0, byEquipment: [] },
        })}
        canViewInspections
      />,
    )
    const [, firmas, horas, fallas] = stripCells(container) as HTMLElement[]
    expect(firmas!.textContent).toContain("Aún no llega ningún reporte en el período")
    expect(horas!.textContent).toContain("Sin horómetros")
    expect(fallas!.textContent).toContain("Ninguna")
    expect(fallas!.textContent).toContain("Sin fallas abiertas · hoy")
    expect(fallas!.textContent).not.toMatch(/\b0\b/)
  })

  it("con reportes en el alcance pero ninguno en el período ni fallas abiertas, un solo vacío con su salida", () => {
    const { container } = render(
      <ReporteEquiposSection
        {...common}
        data={data({
          coverage: { expected: 0, received: 0, percent: null, points: [] },
          signatures: { complete: 0, received: 0, percent: null },
          hours: { total: 0, measuredReports: 0, byEquipment: [] },
          failures: { total: 0, safety: 0, byEquipment: [] },
          bySystem: [],
        })}
        canViewInspections
      />,
    )
    expect(screen.getByRole("heading", { name: "No hay reportes de equipos en este período" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ver reportes en Inspecciones/ }).getAttribute("href")).toBe("/prevencion/inspecciones?q=Reporte+de+Equipos")
    expect(stripCells(container)).toHaveLength(0)
    expect(screen.queryByTestId("chart-por-dia")).toBeNull()
  })

  it("sin permiso para ver inspecciones el vacío no ofrece un enlace que llevaría a «Sin permiso»", () => {
    render(
      <ReporteEquiposSection
        {...common}
        data={data({
          coverage: { expected: 0, received: 0, percent: null, points: [] },
          failures: { total: 0, safety: 0, byEquipment: [] },
          bySystem: [],
        })}
        canViewInspections={false}
      />,
    )
    expect(screen.getByRole("heading", { name: "No hay reportes de equipos en este período" })).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })
})
