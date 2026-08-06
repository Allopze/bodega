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

  // El aside es lectura de apoyo: sin alertas dice que no hay, no desaparece.
  it("sin alertas confirma el estado en vez de dejar el hueco", () => {
    renderResumen()

    expect(screen.getByText("No hay alertas operacionales activas")).toBeDefined()
  })
})
