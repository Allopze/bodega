// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MantEquipmentState } from "@/lib/mantencion/types"

// Los gráficos de recharts se sustituyen: aquí se mira la estructura de las secciones (tiles, enlaces,
// vacíos y qué gráficos se piden), no el dibujo.
vi.mock("./indicators-charts-lazy", () => ({
  WorkOrderFlowChart: () => <div data-testid="chart-flow" />,
  WorkOrderMixChart: () => <div data-testid="chart-mix" />,
  RecordsKindChart: () => <div data-testid="chart-records" />,
  OutOfServiceChart: () => <div data-testid="chart-days" />,
}))
vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { PautasSection, WorkOrdersSection } from "./indicators-sections"

const common = {
  from: "2026-09-01",
  to: "2026-11-13",
  granularity: "month" as const,
  worksiteId: null,
  scopeNote: "01-09-2026 al 13-11-2026 · todas las faenas",
  canExport: false,
}

const point = (key: string, over: Record<string, unknown> = {}) => ({
  key, created: 0, closed: 0, backlog: 0, repairOnly: 0, maintenanceOnly: 0, both: 0, partial: false, ...over,
})
const counts = (over: Partial<Record<MantEquipmentState, number>> = {}): Record<MantEquipmentState, number> => ({
  vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0, ...over,
})

describe("WorkOrdersSection", () => {
  const stats = { closed: 4, closedPrevious: 2, mttrHours: 27, repairClosed: 3, cost: 150_000 }

  it("a lo más cuatro tiles, todos enlaces a /mantencion/ot, con variación y sin enums crudos", () => {
    const { container } = render(
      <WorkOrdersSection
        {...common}
        series={[point("2026-10", { created: 3, closed: 1, backlog: 2 }), point("2026-11", { created: 2, closed: 3, backlog: 1, partial: true })]}
        stats={stats}
        byStatus={[{ status: "solicitada", count: 2 }, { status: "en_ejecucion", count: 1 }]}
      />,
    )
    const region = screen.getByRole("region", { name: "Órdenes de trabajo" })
    const tiles = container.querySelectorAll("[data-kpi-card]")
    expect(tiles).toHaveLength(4)
    for (const link of container.querySelectorAll("a:has([data-kpi-card])")) expect(link.getAttribute("href")).toMatch(/^\/mantencion\/ot\?/)
    expect(within(region).getByRole("link", { name: /OT abiertas/ }).getAttribute("href")).toBe("/mantencion/ot?estado=abiertas")
    // 4 vs 2 cerradas: +100 %.
    expect(within(region).getByRole("link", { name: /^OT cerradas en el período/ }).textContent).toContain("100")
    expect(within(region).getByText("27 h")).toBeTruthy()
    // Estados en español, no el enum.
    expect(region.textContent).toContain("Por asignar")
    expect(region.textContent).toContain("En taller")
    expect(region.textContent).not.toMatch(/solicitada|en_ejecucion/)
    expect(screen.getByTestId("chart-flow")).toBeTruthy()
    expect(screen.getByTestId("chart-mix")).toBeTruthy()
  })

  it("el filtro de faena viaja a los enlaces", () => {
    const { container } = render(
      <WorkOrdersSection {...common} worksiteId="ws-1" series={[point("2026-11", { created: 1 })]} stats={stats} byStatus={[{ status: "solicitada", count: 1 }]} />,
    )
    for (const link of container.querySelectorAll("a:has([data-kpi-card])")) expect(link.getAttribute("href")).toContain("faena=ws-1")
  })

  it("sin ninguna OT muestra un solo vacío con su enlace, sin tiles ni gráficos", () => {
    const { container } = render(
      <WorkOrdersSection {...common} series={[point("2026-11")]} stats={{ closed: 0, closedPrevious: 0, mttrHours: null, repairClosed: 0, cost: null }} byStatus={[]} />,
    )
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    expect(screen.getByRole("heading", { name: "Todavía no hay órdenes de trabajo en este período" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ver órdenes de trabajo/ }).getAttribute("href")).toBe("/mantencion/ot")
    expect(screen.queryByTestId("chart-flow")).toBeNull()
  })

  it("una consulta caída (null) da «Sin dato» en su tile y no pinta su gráfico, sin tumbar al resto", () => {
    const { container } = render(
      <WorkOrdersSection {...common} series={null} stats={null} byStatus={[{ status: "asignada", count: 2 }]} />,
    )
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(4)
    expect(screen.getAllByText("Sin dato").length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByTestId("chart-flow")).toBeNull()
    expect(screen.getAllByText("Asignada").length).toBeGreaterThan(0)
  })

  it("sin cierres en el período un tile dice qué falta en vez de un cero", () => {
    render(
      <WorkOrdersSection {...common} series={[point("2026-11", { created: 1, backlog: 1 })] } stats={{ closed: 0, closedPrevious: 0, mttrHours: null, repairClosed: 0, cost: null }} byStatus={[{ status: "solicitada", count: 1 }]} />,
    )
    expect(screen.getByText("Ninguna OT se cerró en el período")).toBeTruthy()
    expect(screen.getByText("Las OT cerradas no traen costo cargado")).toBeTruthy()
  })
})

describe("PautasSection", () => {
  const base = {
    pautas: { counts: counts({ vencida: 2, proxima: 1, al_dia: 5, sin_lecturas: 2, sin_pauta: 3, baja: 1 }), total: 14 },
    records: { points: [{ key: "2026-11", preventive: 3, corrective: 1, partial: true }], preventive: 3, preventivePrevious: 2 },
    outOfService: { points: [{ key: "2026-11", days: 4.5, partial: true }], total: 4.5, totalPrevious: 3 },
    ranking: [{ vehicleId: "v1", code: "KA-1", plate: "AAAA-01", count: 3 }],
  }

  it("tres tiles con enlace; el % de pautas al día sale de al día sobre los equipos con pauta", () => {
    const { container } = render(<PautasSection {...common} {...base} showRanking />)
    const region = screen.getByRole("region", { name: "Pautas y disponibilidad" })
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(3)
    const tile = within(region).getByRole("link", { name: /Equipos con la pauta al día/ })
    // 5 / (2 + 1 + 5 + 2) = 50 %; con vencidas el tile lleva a la lista de vencidas.
    expect(tile.textContent).toContain("50%")
    expect(tile.getAttribute("href")).toBe("/mantencion/equipos?estado=vencida")
    expect(within(region).getByRole("link", { name: /Registros preventivos/ }).getAttribute("href")).toContain("tipo=P")
    expect(within(region).getByRole("link", { name: /Días fuera de servicio/ }).getAttribute("href")).toBe("/mantencion/equipos?taller=1")
    for (const id of ["chart-records", "chart-days"]) expect(screen.getByTestId(id)).toBeTruthy()
    expect(within(region).getByRole("link", { name: /KA-1 · AAAA-01/ }).getAttribute("href")).toBe("/mantencion/equipos/v1")
    expect(region.textContent).toContain("Sin pauta")
    expect(region.textContent).not.toMatch(/sin_pauta|sin_lecturas/)
  })

  it("quien no ve OT no recibe el ranking, que sale de las órdenes", () => {
    render(<PautasSection {...common} {...base} ranking={null} showRanking={false} />)
    expect(screen.queryByText("Equipos con más OT de reparación")).toBeNull()
    expect(screen.queryByRole("link", { name: "Órdenes de trabajo" })).toBeNull()
  })

  it("sin equipos, registros ni detenciones muestra un solo vacío con su enlace a Equipos", () => {
    const { container } = render(
      <PautasSection
        {...common}
        pautas={{ counts: counts(), total: 0 }}
        records={{ points: [{ key: "2026-11", preventive: 0, corrective: 0, partial: true }], preventive: 0, preventivePrevious: 0 }}
        outOfService={{ points: [{ key: "2026-11", days: 0, partial: true }], total: 0, totalPrevious: 0 }}
        ranking={[]}
        showRanking
      />,
    )
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    expect(screen.getByRole("heading", { name: "Aún no hay equipos con pauta en el módulo" })).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "Pautas y disponibilidad" })).getByRole("link", { name: /Ir a Equipos →/ }).getAttribute("href")).toBe("/mantencion/equipos")
  })

  it("sin equipos con pauta el porcentaje no se inventa: el tile dice qué hacer", () => {
    render(<PautasSection {...common} {...base} pautas={{ counts: counts({ sin_pauta: 4 }), total: 4 }} showRanking />)
    expect(screen.getByText("Aún no hay equipos con pauta")).toBeTruthy()
  })
})
