// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MantEquipmentState } from "@/lib/mantencion/types"

// Los gráficos de recharts se sustituyen: aquí se mira la estructura de las secciones (tira de cifras,
// enlaces, vacíos y qué gráficos se piden), no el dibujo. El gráfico de barras queda como un
// `[role="img"]` con su nombre y una lista de sus ítems (rótulo, cifra, color y enlace).
vi.mock("@/components/charts/bar-ranking-chart-lazy", () => ({
  BarRankingChartLazy: (props: { ariaLabel: string; order?: string; items: Array<{ key: string; label: string; value: number; href?: string; color?: string }> }) => (
    <div role="img" aria-label={`${props.ariaLabel}; «Ver datos» trae las cifras exactas`} data-order={props.order}>
      <ul>
        {props.items.map((item) => (
          <li key={item.key} data-color={item.color ?? ""}>
            {item.href ? <a href={item.href}>{item.label}</a> : item.label}: {item.value}
          </li>
        ))}
      </ul>
    </div>
  ),
}))
// Cada gráfico de evolución expone la granularidad y el pie (`scopeNote`) y la nota del Excel que recibe.
type SeriesChartProps = { granularity: string; scopeNote: string; excel?: { notes?: string[] } }
const seriesChart = (testId: string, props: SeriesChartProps) => (
  <div data-testid={testId} data-granularity={props.granularity} data-note={props.scopeNote} data-excel-note={props.excel?.notes?.[0] ?? ""} />
)
vi.mock("./indicators-charts-lazy", () => ({
  WorkOrderFlowChart: (props: SeriesChartProps) => seriesChart("chart-flow", props),
  WorkOrderMixChart: (props: SeriesChartProps) => seriesChart("chart-mix", props),
  RecordsKindChart: (props: SeriesChartProps) => seriesChart("chart-records", props),
  OutOfServiceChart: (props: SeriesChartProps) => seriesChart("chart-days", props),
}))
vi.mock("@/components/charts/chart-data-export", () => ({ ChartDataExport: () => null }))

import { PautasSection, WorkOrdersSection } from "./indicators-sections"

// Un mes (1–13 nov) con la ventana de los gráficos de seis meses: las series usan `chart`, lo demás el período.
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

const point = (key: string, over: Record<string, unknown> = {}) => ({
  key, created: 0, closed: 0, backlog: 0, repairOnly: 0, maintenanceOnly: 0, both: 0, partial: false, ...over,
})
const counts = (over: Partial<Record<MantEquipmentState, number>> = {}): Record<MantEquipmentState, number> => ({
  vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0, ...over,
})

describe("ventana de los gráficos de evolución", () => {
  it("las series usan la granularidad y el pie de la ventana (también en la nota del Excel); lo de hoy y los rankings, el período", () => {
    const { container } = render(
      <>
        <WorkOrdersSection
          {...common}
          canExport
          series={[point("2026-10", { created: 3, closed: 1, backlog: 2 }), point("2026-11", { created: 2, repairOnly: 2, partial: true })]}
          stats={{ closed: 4, closedPrevious: 2, mttrHours: 27, repairClosed: 3, cost: 150_000 }}
          byStatus={[{ status: "solicitada", count: 2 }]}
        />
        <PautasSection
          {...common}
          canExport
          pautas={{ counts: counts({ al_dia: 2 }), total: 2, inWorkshop: 0, inWorkshopByOrder: 0 }}
          records={{ points: [{ key: "2026-11", preventive: 1, corrective: 0, partial: true }], preventive: 1, preventivePrevious: 0 }}
          outOfService={{ points: [{ key: "2026-11", days: 1, partial: true }], total: 1, totalPrevious: 0 }}
          ranking={[{ vehicleId: "v1", code: "KA-1", plate: "AAAA-01", count: 3 }]}
          showRanking
        />
      </>,
    )
    for (const id of ["chart-flow", "chart-mix", "chart-records", "chart-days"]) {
      const chart = screen.getByTestId(id)
      expect(chart.getAttribute("data-granularity")).toBe("month")
      expect(chart.getAttribute("data-note")).toBe(common.chartNote)
      expect(chart.getAttribute("data-excel-note")).toBe(common.chartNote)
    }
    // El ranking sigue diciendo el período, no la ventana (su descripción y su tabla «Ver datos» van con `scopeNote`).
    expect(container.textContent).toContain(common.scopeNote)
    expect(container.textContent).not.toContain("Últimos 6 meses")
  })
})

describe("WorkOrdersSection", () => {
  const stats = { closed: 4, closedPrevious: 2, mttrHours: 27, repairClosed: 3, cost: 150_000 }

  it("una tira de cifras con enlace a /mantencion/ot, variación en texto y sin tiles ni enums crudos", () => {
    const { container } = render(
      <WorkOrdersSection
        {...common}
        series={[point("2026-10", { created: 3, closed: 1, backlog: 2 }), point("2026-11", { created: 2, closed: 3, backlog: 1, partial: true })]}
        stats={stats}
        byStatus={[{ status: "solicitada", count: 2 }, { status: "en_ejecucion", count: 1 }]}
      />,
    )
    const region = screen.getByRole("region", { name: "Órdenes de trabajo" })
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    const strip = within(region).getAllByRole("link").filter((link) => (link.getAttribute("href") ?? "").startsWith("/mantencion/ot?") && /OT abiertas|OT cerradas|Tiempo medio|Mano de obra/.test(link.textContent ?? ""))
    // Las OT abiertas son el total del gráfico por estado: su cifra va en el titular del gráfico, no repetida en la tira (A5).
    expect(strip).toHaveLength(3)
    expect(within(region).queryByRole("link", { name: /^OT abiertas/ })).toBeNull()
    expect(within(region).getByText("de 3 OT abiertas están en «Por asignar», la etapa con más")).toBeTruthy()
    expect(within(region).getByRole("link", { name: /^Órdenes de trabajo/ }).getAttribute("href")).toBe("/mantencion/ot?estado=abiertas")
    // 4 vs 2 cerradas: +100 %, como texto junto a la cifra.
    expect(within(region).getByRole("link", { name: /^OT cerradas en el período/ }).textContent).toContain("+100 % vs. período anterior")
    expect(within(region).getByText("27 h")).toBeTruthy()
    // Los estados son un gráfico de barras en el orden del flujo, con su enlace; en español, no el enum.
    const chart = within(region).getByRole("img", { name: /^OT abiertas hoy por estado/ })
    expect(chart.getAttribute("data-order")).toBe("input")
    expect(within(chart).getByRole("link", { name: "Por asignar" }).getAttribute("href")).toBe("/mantencion/ot?estado=solicitada")
    expect(within(chart).getByText(/En taller/)).toBeTruthy()
    // Un solo tono, el de lo pendiente: ninguna etapa abierta sale en el verde de lo terminado (paso 5).
    expect([...chart.querySelectorAll("li")].map((item) => item.getAttribute("data-color"))).toEqual(["var(--color-signal)", "var(--color-signal)"])
    expect(region.textContent).not.toMatch(/solicitada|en_ejecucion/)
    expect(screen.getByTestId("chart-flow")).toBeTruthy()
    expect(screen.getByTestId("chart-mix")).toBeTruthy()
  })

  it("el filtro de faena viaja a los enlaces", () => {
    render(
      <WorkOrdersSection {...common} worksiteId="ws-1" series={[point("2026-11", { created: 1 })]} stats={stats} byStatus={[{ status: "solicitada", count: 1 }]} />,
    )
    const region = screen.getByRole("region", { name: "Órdenes de trabajo" })
    for (const name of [/^OT cerradas en el período/, /^Tiempo medio/, /^Mano de obra/]) {
      expect(within(region).getByRole("link", { name }).getAttribute("href")).toContain("faena=ws-1")
    }
    expect(within(region).getByRole("link", { name: "Por asignar" }).getAttribute("href")).toContain("faena=ws-1")
  })

  it("sin ninguna OT muestra un solo vacío con su enlace, sin cifras ni gráficos", () => {
    const { container } = render(
      <WorkOrdersSection {...common} series={[point("2026-11")]} stats={{ closed: 0, closedPrevious: 0, mttrHours: null, repairClosed: 0, cost: null }} byStatus={[]} />,
    )
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    expect(screen.queryByRole("link", { name: /^OT abiertas/ })).toBeNull()
    expect(screen.getByRole("heading", { name: "Todavía no hay órdenes de trabajo en este período" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ver órdenes de trabajo/ }).getAttribute("href")).toBe("/mantencion/ot")
    expect(screen.queryByTestId("chart-flow")).toBeNull()
  })

  it("una consulta caída (null) da «Sin dato» en su cifra y no pinta su gráfico, sin tumbar al resto", () => {
    render(
      <WorkOrdersSection {...common} series={null} stats={null} byStatus={[{ status: "asignada", count: 2 }]} />,
    )
    expect(screen.getAllByText("Sin dato")).toHaveLength(3)
    expect(screen.getByText("OT abiertas, todas en «Asignada»")).toBeTruthy()
    expect(screen.queryByTestId("chart-flow")).toBeNull()
    expect(within(screen.getByRole("img", { name: /^OT abiertas hoy por estado/ })).getByText(/Asignada/)).toBeTruthy()
  })

  it("sin el gráfico por estado, la cifra de OT abiertas vuelve a la tira", () => {
    render(<WorkOrdersSection {...common} series={[point("2026-11", { created: 1 })]} stats={stats} byStatus={null} />)
    const abiertas = screen.getByRole("link", { name: /^OT abiertas/ })
    expect(abiertas.textContent).toContain("Sin dato")
    expect(abiertas.getAttribute("href")).toBe("/mantencion/ot?estado=abiertas")
    expect(screen.queryByRole("img", { name: /^OT abiertas hoy por estado/ })).toBeNull()
  })

  it("sin cierres en el período la cifra dice qué falta en vez de un cero", () => {
    render(
      <WorkOrdersSection {...common} series={[point("2026-11", { created: 1, backlog: 1 })] } stats={{ closed: 0, closedPrevious: 0, mttrHours: null, repairClosed: 0, cost: null }} byStatus={[{ status: "solicitada", count: 1 }]} />,
    )
    expect(screen.getByText("Ninguna OT se cerró en el período")).toBeTruthy()
    // «Sin dato» es una consulta que falló; sin cierres, el costo dice por qué no hay cifra (crítica 2026-11-15).
    const costo = screen.getByRole("link", { name: /^Mano de obra y taller/ })
    expect(costo.textContent).toContain("Sin OT cerradas")
    expect(costo.textContent).not.toContain("Sin dato")
    expect(screen.getByRole("link", { name: /^Tiempo medio de reparación/ }).textContent).toContain("Sin reparaciones")
  })

  it("con OT cerradas sin costo cargado, la cifra dice cuántas y dónde se carga", () => {
    render(
      <WorkOrdersSection {...common} series={[point("2026-11", { created: 1, closed: 3 })]} stats={{ closed: 3, closedPrevious: 0, mttrHours: 12, repairClosed: 3, cost: null }} byStatus={[{ status: "solicitada", count: 1 }]} />,
    )
    const costo = screen.getByRole("link", { name: /^Mano de obra y taller/ })
    expect(costo.textContent).toContain("Sin costo cargado")
    expect(costo.textContent).toContain("Ninguna de las 3 OT cerradas trae costo")
  })
})

describe("PautasSection", () => {
  const base = {
    pautas: { counts: counts({ vencida: 2, proxima: 1, al_dia: 5, sin_lecturas: 2, sin_pauta: 3, baja: 1 }), total: 14, inWorkshop: 1, inWorkshopByOrder: 1 },
    records: { points: [{ key: "2026-11", preventive: 3, corrective: 1, partial: true }], preventive: 3, preventivePrevious: 2 },
    outOfService: { points: [{ key: "2026-11", days: 4.5, partial: true }], total: 4.5, totalPrevious: 3 },
    ranking: [{ vehicleId: "v1", code: "KA-1", plate: "AAAA-01", count: 3 }],
  }

  it("tres cifras con enlace en la tira; el % de pautas al día sale de al día sobre los equipos con pauta", () => {
    const { container } = render(<PautasSection {...common} {...base} showRanking />)
    const region = screen.getByRole("region", { name: "Pautas y disponibilidad" })
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    const stat = within(region).getByRole("link", { name: /Equipos con la pauta al día/ })
    // 5 / (2 + 1 + 5 + 2) = 50 %; con vencidas la cifra lleva a la lista de vencidas.
    expect(stat.textContent).toContain("50%")
    expect(stat.getAttribute("href")).toBe("/mantencion/equipos?estado=vencida")
    const preventivos = within(region).getByRole("link", { name: /Registros preventivos/ })
    expect(preventivos.getAttribute("href")).toContain("tipo=P")
    // 3 vs 2: +50 %.
    expect(preventivos.textContent).toContain("+50 % vs. período anterior")
    const dias = within(region).getByRole("link", { name: /Días fuera de servicio/ })
    expect(dias.getAttribute("href")).toBe("/mantencion/equipos?taller=1")
    expect(dias.textContent).toContain("+50 % vs. período anterior")
    for (const id of ["chart-records", "chart-days"]) expect(screen.getByTestId(id)).toBeTruthy()
    // Las pautas de hoy y el ranking son gráficos de barras, no franjas ni listas.
    const pautas = within(region).getByRole("img", { name: /^Equipos por estado de pauta hoy/ })
    expect(pautas.getAttribute("data-order")).toBe("input")
    expect(within(pautas).getByRole("link", { name: "Vencida" }).getAttribute("href")).toBe("/mantencion/equipos?estado=vencida")
    const ranking = within(region).getByRole("img", { name: /^Equipos con más órdenes de trabajo de reparación/ })
    expect(ranking.getAttribute("data-order")).toBe("desc")
    expect(within(ranking).getByRole("link", { name: "KA-1 · AAAA-01" }).getAttribute("href")).toBe("/flota/v1/mantencion")
    expect(region.textContent).toContain("Sin pauta")
    expect(region.textContent).not.toMatch(/sin_pauta|sin_lecturas/)
  })

  it("con empate en la cima no hay un «equipo con más»: se dice cuántos empatan", () => {
    render(
      <PautasSection
        {...common}
        {...base}
        ranking={[{ vehicleId: "v1", code: "KA-1", plate: "AAAA-01", count: 2 }, { vehicleId: "v2", code: "KA-2", plate: "AAAA-02", count: 2 }, { vehicleId: "v3", code: "KA-3", plate: "AAAA-03", count: 2 }]}
        showRanking
      />,
    )
    expect(screen.getByText("3 equipos empatan con 2 OT de reparación en el período")).toBeTruthy()
    expect(screen.queryByText(/el equipo con más/)).toBeNull()
  })

  it("sin equipos repetidos (ranking vacío) no se pinta la celda del ranking", () => {
    render(<PautasSection {...common} {...base} ranking={[]} showRanking />)
    expect(screen.queryByText("Equipos con más OT de reparación")).toBeNull()
    // Con tres gráficos «one» la fila a 2 columnas quedaría coja: `layoutChartSlots` ensancha uno para cerrarla.
    const cells = [
      screen.getByTestId("chart-records"),
      screen.getByRole("heading", { name: "Estado de las pautas hoy" }),
      screen.getByTestId("chart-days"),
    ].map((node) => node.closest("div.min-w-0.border-l"))
    expect(cells.every((cell) => cell !== null)).toBe(true)
    expect(cells.filter((cell) => cell?.className.includes("xl:col-span-2")).length).toBe(1)
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
        pautas={{ counts: counts(), total: 0, inWorkshop: 0, inWorkshopByOrder: 0 }}
        records={{ points: [{ key: "2026-11", preventive: 0, corrective: 0, partial: true }], preventive: 0, preventivePrevious: 0 }}
        outOfService={{ points: [{ key: "2026-11", days: 0, partial: true }], total: 0, totalPrevious: 0 }}
        ranking={[]}
        showRanking
      />,
    )
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(0)
    expect(screen.queryByRole("link", { name: /Equipos con la pauta al día/ })).toBeNull()
    expect(screen.getByRole("heading", { name: "Aún no hay equipos con pauta en el módulo" })).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "Pautas y disponibilidad" })).getByRole("link", { name: /Ir a Equipos →/ }).getAttribute("href")).toBe("/mantencion/equipos")
  })

  it("sin equipos con pauta el porcentaje no se inventa: la cifra dice qué falta", () => {
    render(<PautasSection {...common} {...base} pautas={{ counts: counts({ sin_pauta: 4 }), total: 4, inWorkshop: 0, inWorkshopByOrder: 0 }} showRanking />)
    expect(screen.getByText("Aún no hay equipos con pauta")).toBeTruthy()
  })
})
