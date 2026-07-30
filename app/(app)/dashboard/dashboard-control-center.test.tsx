// @vitest-environment jsdom

import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import type { WorkTask } from "@/lib/work-queue"
import { DashboardControlCenter } from "./dashboard-control-center"

const tasks: WorkTask[] = [
  {
    id: "approval:req-1",
    type: "approval",
    title: "Revisar SOL-001",
    subtitle: "Faena Norte · 2 ítems pendientes",
    worksiteId: "ws-norte",
    worksiteName: "Faena Norte",
    statusLabel: "Necesita aprobación",
    priority: "critical",
    createdAt: "2026-07-24T10:00:00.000Z",
    href: "/aprobaciones?solicitud=req-1",
    ctaLabel: "Revisar ítems",
  },
  {
    id: "receipt:oc-1",
    type: "receipt",
    title: "Recibir en faena OC-001",
    subtitle: "Faena Sur · Proveedor · 1 ítem",
    worksiteId: "ws-sur",
    worksiteName: "Faena Sur",
    statusLabel: "Pendiente de faena",
    priority: "normal",
    createdAt: "2026-07-25T10:00:00.000Z",
    href: "/recepcion/nueva?oc=oc-1",
    ctaLabel: "Recibir en faena",
  },
]

const worksiteOptions = [
  { id: "ws-norte", name: "Faena Norte" },
  { id: "ws-sur", name: "Faena Sur" },
]

function renderControlCenter(props: Partial<React.ComponentProps<typeof DashboardControlCenter>> = {}) {
  return render(
    <DashboardControlCenter
      firstName="Ana"
      contextLabel="Faenas autorizadas"
      refreshedAt="2026-07-25T12:00:00.000Z"
      tasks={tasks}
      queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
      queueShortcuts={[]}
      worksiteOptions={worksiteOptions}
      canAssign={false}
      periodSummary={[]}
      backlogSummary={[]}
      metrics={[]}
      alerts={[]}
      {...props}
    />,
  )
}

describe("DashboardControlCenter", () => {
  beforeEach(() => sessionStorage.clear())

  it("filters the queue by worksite", () => {
    renderControlCenter()

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena Norte" }))

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.queryByText("Recibir en faena OC-001")).toBeNull()
    expect(screen.getByText("1 de 2 visibles")).toBeDefined()
  })

  it("uses the complete authorized queue for the contextual summary", () => {
    renderControlCenter({ queueSummary: { total: 39, critical: 4, overdue: 3, deliveries: 2 } })

    expect(screen.getByText(/39 tareas pendientes, 4 críticas, 3 vencidas, 2 entregas por registrar/i)).toBeDefined()
  })

  // Regresión D-01: los conteos de los atajos son de población completa; las
  // filas cargadas son sólo las más urgentes. Antes ambos salían de `tasks` y
  // el saludo contradecía a los chips.
  it("announces the truncation instead of passing the page off as the whole queue", () => {
    renderControlCenter({
      queueSummary: { total: 214, critical: 12, overdue: 7, deliveries: 3 },
      queueShortcuts: [
        { key: "all", label: "Todas", count: 214, href: "/pendientes" },
        { key: "critical", label: "Críticas", count: 12, href: "/pendientes?quick=critical" },
      ],
    })

    expect(screen.getByRole("link", { name: /Críticas\s*12/ })).toHaveAttribute("href", "/pendientes?quick=critical")
    expect(screen.getByText(/Mostrando las/).textContent).toMatch(/Mostrando las\s*2\s*más urgentes de\s*214\s*tareas pendientes\./)
    expect(screen.getByRole("link", { name: "Abrir cola completa" })).toHaveAttribute("href", "/pendientes")
    expect(screen.getByText("Las 2 tareas más urgentes de tus faenas autorizadas.", { exact: false })).toBeDefined()
  })

  it("does not announce truncation when the whole queue fits", () => {
    renderControlCenter()

    expect(screen.queryByText(/Mostrando las/)).toBeNull()
  })

  it("restores the persisted worksite filter after a refresh", () => {
    sessionStorage.setItem("dashboard:queue-filters", JSON.stringify({ worksiteId: "ws-sur", sort: "newest" }))
    renderControlCenter()

    expect(screen.queryByText("Revisar SOL-001")).toBeNull()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()
  })

  it("keeps an honest period comparison in the compact flow summary", () => {
    renderControlCenter({
      periodSummary: [
        { key: "requests", label: "Solicitudes creadas", value: 7, comparison: "+2 vs. mes anterior", href: "/solicitudes" },
        { key: "orders", label: "OC emitidas", value: 0, comparison: "Sin período comparable", href: "/compras" },
      ],
    })

    expect(screen.getByRole("link", { name: /Solicitudes creadas: 7.*\+2 vs\. mes anterior/i })).toHaveAttribute("href", "/solicitudes")
    expect(screen.getByText("Sin período comparable")).toBeDefined()
  })

  // Regresión C1: la antigüedad se contaba en múltiplos de 24h, así que algo
  // creado ayer a las 23:00 y visto hoy a la 01:00 decía "Hoy".
  it("counts age in Chilean calendar days, not in 24h blocks", () => {
    renderControlCenter({
      // 2026-07-25 23:00 en Chile (UTC-4) = 2026-07-26T03:00Z
      tasks: [{ ...tasks[0]!, createdAt: "2026-07-26T03:00:00.000Z" }],
      // 2026-07-26 01:00 en Chile = 2026-07-26T05:00Z — dos horas después, otro día
      refreshedAt: "2026-07-26T05:00:00.000Z",
    })

    expect(screen.getByText("1 día")).toBeDefined()
  })

  it("renders a sparkline only when the entry carries a real series", () => {
    const { container } = renderControlCenter({
      backlogSummary: [
        { key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "+1 vs. 28-07", href: "/pendientes?module=solicitudes", sparkline: [3, 5, 4, 6] },
        { key: "backlog_orders", label: "OC activas", value: 2, comparison: "Sin snapshot completo previo", href: "/pendientes?module=compras" },
      ],
    })

    expect(container.querySelectorAll("polyline")).toHaveLength(1)
  })

  it("shows backlog only with its real snapshot state", () => {
    renderControlCenter({
      backlogSummary: [
        { key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "Sin snapshot completo previo", href: "/pendientes?module=solicitudes" },
      ],
    })

    expect(screen.getByRole("link", { name: /Solicitudes activas: 4.*Sin snapshot completo previo/i })).toHaveAttribute("href", "/pendientes?module=solicitudes")
  })
})
