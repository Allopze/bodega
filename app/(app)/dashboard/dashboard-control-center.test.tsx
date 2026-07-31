// @vitest-environment jsdom

import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkTask } from "@/lib/work-queue"
import { DashboardControlCenter } from "./dashboard-control-center"
import type { DashboardScope } from "./dashboard-scope"

// El selector de faena del alcance global navega con `router.replace`. En jsdom
// no hay router de Next, y sin este mock el componente entero no monta.
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

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

const allWorksitesScope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes" }

function renderControlCenter(props: Partial<React.ComponentProps<typeof DashboardControlCenter>> = {}) {
  return render(
    <DashboardControlCenter
      firstName="Ana"
      contextLabel="Todas mis faenas autorizadas"
      refreshedAt="2026-07-25T12:00:00.000Z"
      tasks={tasks}
      queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
      queueShortcuts={[]}
      scope={allWorksitesScope}
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

  // La faena dejó de filtrar en cliente: la cola llega ya consultada con el
  // alcance global. Filtrar otra vez acá sobre 12 filas sólo podía contradecir
  // los conteos de población completa de los atajos (la causa de D-01).
  it("no vuelve a filtrar por faena en el cliente", () => {
    renderControlCenter()

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()
    expect(screen.getByText("2 de 2 visibles")).toBeDefined()
  })

  it("elegir faena reencuadra el tablero por la URL, no la lista", () => {
    renderControlCenter()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena Norte" }))

    // Navega al alcance nuevo; no esconde filas por su cuenta.
    expect(replace).toHaveBeenCalledWith("/dashboard?faena=ws-norte", { scroll: false })
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()
  })

  // `WorksiteSelect` emite "" al elegir "todas", no el `allValue`. Sin
  // normalizar, la URL quedaba con un `?faena=` vacío colgando.
  it("volver a todas las faenas limpia el parámetro en vez de dejarlo vacío", () => {
    renderControlCenter({ scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "anio" } })

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Todas las faenas" }))

    expect(replace).toHaveBeenCalledWith("/dashboard?periodo=anio", { scroll: false })
  })

  it("ofrece los tres períodos como enlaces que conservan la faena", () => {
    renderControlCenter({ scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes" } })

    expect(screen.getByRole("link", { name: "Trimestre" })).toHaveAttribute("href", "/dashboard?faena=ws-sur&periodo=trimestre")
    expect(screen.getByRole("link", { name: "Año" })).toHaveAttribute("href", "/dashboard?faena=ws-sur&periodo=anio")
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("aria-current", "page")
  })

  // Un rol de faena única no tiene nada que elegir.
  it("esconde el selector de faena con una sola faena autorizada", () => {
    renderControlCenter({ worksiteOptions: [{ id: "ws-norte", name: "Faena Norte" }] })

    expect(screen.queryByRole("combobox", { name: "Faena del tablero" })).toBeNull()
    expect(screen.getByRole("link", { name: "Trimestre" })).toBeDefined()
  })

  it("uses the complete authorized queue for the contextual summary", () => {
    renderControlCenter({ queueSummary: { total: 39, critical: 4, overdue: 3, deliveries: 2 } })

    expect(screen.getByText(/Tienes 39 tareas pendientes\./i)).toBeDefined()
  })

  // A5: el saludo declara una sola cifra. Antes enumeraba críticas, vencidas y
  // entregas, y cada una de esas ya vivía en su atajo y en su alerta —"críticas"
  // aparecía cuatro veces en la misma pantalla contando el tile.
  it("no repite críticas ni vencidas en el saludo", () => {
    renderControlCenter({ queueSummary: { total: 39, critical: 4, overdue: 3, deliveries: 2 } })

    const greeting = screen.getByText(/Tienes 39 tareas pendientes/i).textContent ?? ""
    expect(greeting).not.toMatch(/crítica/i)
    expect(greeting).not.toMatch(/vencida/i)
    expect(greeting).not.toMatch(/entrega/i)
  })

  it("nombra la faena del alcance en el saludo", () => {
    renderControlCenter({
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes" },
      queueSummary: { total: 5, critical: 0, overdue: 0, deliveries: 0 },
    })

    expect(screen.getByText("Tienes 5 tareas pendientes en Faena Sur.")).toBeDefined()
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

  // Sólo el orden queda en sessionStorage; la faena vive en la URL. Una clave
  // vieja con `worksiteId` no debe volver a esconder filas.
  it("restaura el orden persistido y ya no la faena", () => {
    sessionStorage.setItem("dashboard:queue-filters", JSON.stringify({ worksiteId: "ws-sur", sort: "newest" }))
    const { container } = renderControlCenter()

    // La faena guardada ya no esconde nada: las dos filas siguen ahí.
    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()

    // Pero `sort: "newest"` sí se restaura: la del 25 va antes que la del 24.
    const text = container.textContent ?? ""
    expect(text.indexOf("Recibir en faena OC-001")).toBeLessThan(text.indexOf("Revisar SOL-001"))
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
