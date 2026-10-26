// @vitest-environment jsdom

import * as React from "react"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardResumenBody } from "./dashboard-control-center"
import type { DashboardScope } from "./dashboard-scope"
import type { ActivityGroup } from "./activity-groups"
import { RecentActivity } from "./recent-activity"

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
  it("dibuja la variación del flujo con <Delta> y la dice en texto", () => {
    renderResumen({
      periodSummary: [
        { key: "requests", label: "Solicitudes creadas", value: 7, comparison: "+2 vs. mes anterior", href: "/solicitudes", delta: { value: 2, polarity: "neutral", format: "number", label: "vs. sep" } },
        { key: "orders", label: "OC emitidas", value: 0, comparison: "Sin período comparable", href: "/compras", delta: { value: null, polarity: "neutral", format: "number", label: "vs. sep" } },
      ],
    })

    // Delta aporta el texto accesible ("Sube 2 vs. sep"); el visible es "↑ 2 vs. sep".
    expect(screen.getByRole("link", { name: /Solicitudes creadas.*7.*Sube 2 vs\. sep/i })).toHaveAttribute("href", "/solicitudes")
    // Sin período anterior no hay variación que inventar: queda el texto de respaldo.
    expect(screen.getByText("Sin período comparable")).toBeDefined()
    expect(screen.getByRole("link", { name: /OC emitidas.*0.*Sin período comparable/i })).toHaveAttribute("href", "/compras")
  })

  // Los flujos son volúmenes: que suban no es bueno ni malo, así que no se
  // pintan de verde ni de rojo. El backlog que sube sí es atraso.
  it("pinta cada variación según la polaridad de su fila", () => {
    const { container } = renderResumen({
      periodSummary: [
        { key: "requests", label: "Solicitudes creadas", value: 7, comparison: "", href: "/solicitudes", delta: { value: 2, polarity: "neutral", label: "vs. sep" } },
      ],
      backlogSummary: [
        { key: "backlog_orders", label: "OC activas", value: 14, comparison: "", href: "/pendientes?module=compras", delta: { value: 3, polarity: "up-bad", label: "vs. 07-09" } },
        { key: "backlog_capa", label: "CAPA abiertas", value: 2, comparison: "", href: "/pendientes?module=capa", delta: { value: -1, polarity: "up-bad", label: "vs. 07-09" } },
      ],
    })

    const tones = [...container.querySelectorAll("[data-delta]")].map((node) => node.getAttribute("data-delta"))
    // flujo neutral · OC activas sube = malo · CAPA baja = bueno
    expect(tones).toEqual(["neutral", "negative", "positive"])
    expect(screen.getByRole("link", { name: /OC activas.*14.*Sube 3 vs\. 07-09/i })).toBeDefined()
    expect(screen.getByRole("link", { name: /CAPA abiertas.*2.*Baja 1 vs\. 07-09/i })).toBeDefined()
  })

  it("una variación en cero se dice sin variación", () => {
    renderResumen({
      periodSummary: [
        { key: "receipts", label: "Recepciones", value: 2, comparison: "Sin variación vs. mes anterior", href: "/recepcion", delta: { value: 0, polarity: "neutral", label: "vs. sep" } },
      ],
    })

    expect(screen.getByRole("link", { name: /Recepciones.*2.*Sin variación vs\. sep/i })).toHaveAttribute("href", "/recepcion")
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

    // La cifra va antes que el texto de respaldo en el DOM: "… 4, sin corte…".
    expect(screen.getByRole("link", { name: /Solicitudes activas.*4.*Sin snapshot completo previo/i })).toHaveAttribute("href", "/pendientes?module=solicitudes")
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
    // La insignia visible se fue; la palabra sigue en el enlace como texto solo para lector.
    expect(alert).toHaveTextContent("Crítica")
    expect(alert.querySelector(".sr-only")).not.toBeNull()
    expect(screen.queryAllByText("Crítica", { selector: ":not(.sr-only)" })).toHaveLength(0)
  })

  it("la lista de alertas lleva el nombre «Requiere atención» y cuenta las activas", () => {
    renderResumen({
      alerts: [
        { key: "critical", title: "tareas críticas", description: "x", count: 2, severity: "critical", href: "/pendientes?quick=critical" },
        { key: "approvals", title: "ítem espera aprobación", description: "x", count: 1, severity: "warning", href: "/pendientes?module=aprobaciones" },
        { key: "deliveries", title: "entregas por registrar", description: "x", count: 7, severity: "info", href: "/pendientes?module=entregas" },
      ],
    })

    const list = screen.getByRole("list", { name: "Requiere atención" })
    const links = within(list).getAllByRole("link")
    expect(links).toHaveLength(3)
    // Cada severidad dice su palabra: Crítica · Atención · Pendiente.
    expect(links[0]).toHaveTextContent("Crítica")
    expect(links[1]).toHaveTextContent("Atención")
    expect(links[2]).toHaveTextContent("Pendiente")
    expect(screen.getByText("3 activas")).toBeDefined()
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

  it("la lista «Lo más urgente» conserva su nombre y no lleva marco propio", () => {
    renderResumen({
      todayItems: [{ id: "a", title: "Recibir OC", context: "Recepciones", href: "/compras/1", ctaLabel: "Recibir", dueLabel: "Vence hoy", due: "today", critical: false }],
    })

    const list = screen.getByRole("list", { name: "Lo más urgente de tus pendientes" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(1)
    // Las filas se separan con `divide-y`; nada de caja, radio ni sombra propia.
    for (const surface of ["border", "rounded-xl", "rounded-2xl", "shadow-xs"]) expect(list.classList.contains(surface)).toBe(false)
  })
})

describe("DashboardResumenBody — la fila de gráficos y apoyo", () => {
  const trend = <div data-testid="trend">tendencia</div>
  const gauge = <div data-testid="gauge">medidor</div>
  const activity = <div data-testid="activity">actividad</div>
  const flow = [{ key: "requests", label: "Solicitudes creadas", value: 7, comparison: "x", href: "/solicitudes" }]
  const backlog = [{ key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "x", href: "/pendientes" }]

  const spanOf = (testId: string) => screen.getByTestId(testId).parentElement!.className

  it("tendencia 8 + medidor 4, y tres bloques de apoyo de 4", () => {
    renderResumen({ trendSlot: trend, gaugeSlot: gauge, activitySlot: activity, periodSummary: flow, backlogSummary: backlog })

    expect(spanOf("trend")).toContain("lg:col-span-8")
    expect(spanOf("gauge")).toContain("lg:col-span-4")
    expect(spanOf("activity")).toContain("lg:col-span-4")
    expect(screen.getByRole("region", { name: "Flujo del mes" }).parentElement!.className).toContain("lg:col-span-4")
    expect(screen.getByRole("region", { name: "Pendientes comparados" }).parentElement!.className).toContain("lg:col-span-4")
  })

  // Sin huecos: si falta un bloque, los demás se reparten la fila.
  it("sin tendencia el medidor ocupa la fila entera", () => {
    renderResumen({ gaugeSlot: gauge })

    expect(spanOf("gauge")).toContain("lg:col-span-12")
  })

  it("sin medidor la tendencia ocupa la fila entera", () => {
    renderResumen({ trendSlot: trend })

    expect(spanOf("trend")).toContain("lg:col-span-12")
  })

  it("con dos bloques de apoyo, mitad y mitad; con uno, la fila entera", () => {
    const { unmount } = renderResumen({ periodSummary: flow, activitySlot: activity })
    expect(spanOf("activity")).toContain("lg:col-span-6")
    expect(screen.getByRole("region", { name: "Flujo del mes" }).parentElement!.className).toContain("lg:col-span-6")
    unmount()

    renderResumen({ activitySlot: activity })
    expect(spanOf("activity")).toContain("lg:col-span-12")
  })

  it("ninguna de las superficies lleva tarjeta propia: las divisiones son del panel", () => {
    const { container } = renderResumen({ trendSlot: trend, gaugeSlot: gauge, activitySlot: activity, periodSummary: flow, backlogSummary: backlog })

    expect(container.querySelectorAll("[data-dashboard-panel]").length).toBeGreaterThan(0)
    expect(container.querySelector(".shadow-xs")).toBeNull()
  })
})

describe("RecentActivity", () => {
  const group = (over: Partial<ActivityGroup> = {}): ActivityGroup => ({
    id: "a", module: "pdtp", actionLabel: "Obligación PDTP reportada", entityCode: "OB-1", worksiteName: "Masisa",
    actorName: "Alejandro López", occurredAt: "2026-10-20T17:24:00.000Z", href: "/prevencion/pdtp", count: 1, ids: ["a"], ...over,
  })

  it("un movimiento suelto muestra su código y ninguna píldora", () => {
    render(<RecentActivity groups={[group()]} />)

    expect(screen.getByText("OB-1")).toBeDefined()
    expect(screen.queryByText(/×\d/)).toBeNull()
  })

  it("un grupo muestra «×N» y no atribuye el código a toda la tanda", () => {
    render(<RecentActivity groups={[group({ count: 6, ids: ["a", "b", "c", "d", "e", "f"] })]} />)

    expect(screen.getByText("×6")).toBeDefined()
    expect(screen.getByText("6 veces")).toBeDefined()
    expect(screen.queryByText("OB-1")).toBeNull()
  })

  it("sin movimientos enseña qué pasa y ofrece la cola", () => {
    render(<RecentActivity groups={[]} />)

    expect(screen.getByText("Todavía no hay movimientos")).toBeDefined()
    expect(screen.getByRole("link", { name: "Ver mis pendientes" })).toHaveAttribute("href", "/pendientes")
  })

  // Ninguna pantalla lista estos eventos: un enlace "Ver toda la actividad" no tendría destino.
  it("no ofrece «Ver toda la actividad»", () => {
    render(<RecentActivity groups={[group()]} />)

    expect(screen.queryByText(/Ver toda la actividad/)).toBeNull()
  })
})
