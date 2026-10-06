// @vitest-environment jsdom

import * as React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardResumenBody } from "./dashboard-control-center"
import type { DashboardScope } from "./dashboard-scope"

const scope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" }

function renderResumen(props: Partial<React.ComponentProps<typeof DashboardResumenBody>> = {}) {
  return render(
    <DashboardResumenBody
      scope={scope}
      metrics={[]}
      alerts={[]}
      periodSummary={[]}
      backlogSummary={[]}
      {...props}
    />,
  )
}

describe("DashboardResumenBody", () => {
  it("keeps an honest period comparison in the compact flow summary", () => {
    renderResumen({
      periodSummary: [
        { key: "requests", label: "Solicitudes creadas", value: 7, comparison: "+2 vs. mes anterior", href: "/solicitudes" },
        { key: "orders", label: "OC emitidas", value: 0, comparison: "Sin período comparable", href: "/compras" },
      ],
    })

    expect(screen.getByRole("link", { name: /Solicitudes creadas: 7.*\+2 vs\. mes anterior/i })).toHaveAttribute("href", "/solicitudes")
    expect(screen.getByText("Sin período comparable")).toBeDefined()
  })

  it("renders a sparkline only when the entry carries a real series", () => {
    const { container } = renderResumen({
      backlogSummary: [
        { key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "+1 vs. 28-07", href: "/pendientes?module=solicitudes", sparkline: [3, 5, 4, 6] },
        { key: "backlog_orders", label: "OC activas", value: 2, comparison: "Sin snapshot completo previo", href: "/pendientes?module=compras" },
      ],
    })

    expect(container.querySelectorAll("polyline")).toHaveLength(1)
  })

  it("shows backlog only with its real snapshot state", () => {
    renderResumen({
      backlogSummary: [
        { key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "Sin snapshot completo previo", href: "/pendientes?module=solicitudes" },
      ],
    })

    expect(screen.getByRole("link", { name: /Solicitudes activas: 4.*Sin snapshot completo previo/i })).toHaveAttribute("href", "/pendientes?module=solicitudes")
  })

  // El título de la lista sigue al período elegido: con "Flujo del mes" fijo
  // habría rotulado una ventana que no era la suya.
  it("el rótulo del flujo sigue al período del alcance", () => {
    renderResumen({
      scope: { ...scope, period: "trimestre" },
      periodSummary: [{ key: "requests", label: "Solicitudes creadas", value: 7, comparison: "+2 vs. trimestre anterior", href: "/solicitudes" }],
    })

    expect(screen.getByRole("region", { name: "Flujo del trimestre" })).toBeDefined()
  })

  // "Hoy" va primero y, sin nada urgente, lo dice con un enlace real a la cola.
  it("sin alertas ni pendientes dice que no hay nada urgente y ofrece la cola", () => {
    renderResumen()

    expect(screen.getByText("Nada urgente hoy en tus faenas")).toBeDefined()
    expect(screen.getByRole("link", { name: "Ver mis pendientes" })).toHaveAttribute("href", "/pendientes")
  })

  it("nombra la faena elegida en el estado vacío", () => {
    renderResumen({ scope: { ...scope, worksiteId: "ws-1", worksiteName: "Faena Norte" }, pendientesHref: "/pendientes?worksiteId=ws-1" })

    expect(screen.getByText("Nada urgente hoy en Faena Norte")).toBeDefined()
    expect(screen.getByRole("link", { name: "Ver mis pendientes" })).toHaveAttribute("href", "/pendientes?worksiteId=ws-1")
  })

  it("Hoy es lo primero del DOM: va antes que los indicadores", () => {
    const { container } = renderResumen({
      metrics: [{ key: "spend", label: "Gasto en OC", value: "$0", description: "x", icon: "investment" }],
    })

    const hoy = container.querySelector("#hoy-titulo")!
    const panorama = container.querySelector("#indicadores-operacionales")!
    expect(hoy.compareDocumentPosition(panorama) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("las alertas son enlaces a su subconjunto y dicen su severidad en texto", () => {
    renderResumen({
      alerts: [{ key: "overdue", title: "tareas vencidas", description: "Ya pasó su fecha de vencimiento.", count: 215, severity: "critical", href: "/pendientes?quick=overdue" }],
      pendingTotal: 331,
    })

    const alert = screen.getByRole("link", { name: /215.*tareas vencidas/ })
    expect(alert).toHaveAttribute("href", "/pendientes?quick=overdue")
    expect(alert).toHaveTextContent("Crítica")
  })

  it("muestra las filas urgentes y UN solo enlace a Mis pendientes con el total", () => {
    renderResumen({
      todayItems: [
        { id: "a", title: "Recibir OC-2026-0001", context: "Recepciones · Faena Norte", href: "/compras/1", ctaLabel: "Recibir", dueLabel: "Vencida hace 74 días", due: "overdue", critical: false },
        { id: "b", title: "Aprobar Cinta", context: "Aprobaciones · Faena Sur", href: "/aprobaciones", ctaLabel: "Aprobar", dueLabel: "Vence hoy", due: "today", critical: true },
      ],
      pendingTotal: 331,
    })

    expect(screen.getByText("Vencida hace 74 días")).toBeDefined()
    expect(screen.getByText("Vence hoy")).toBeDefined()
    const links = screen.getAllByRole("link", { name: "Ver todos mis pendientes (331)" })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute("href", "/pendientes")
    // Ninguno de los nombres que la cola tuvo antes.
    expect(screen.queryByText(/Cola de trabajo|Mi trabajo|Tareas pendientes/)).toBeNull()
  })

  it("sin permiso de cola no ofrece el enlace ni las filas", () => {
    renderResumen({ queueVisible: false })

    expect(screen.queryByRole("link", { name: /pendientes/i })).toBeNull()
  })
})
