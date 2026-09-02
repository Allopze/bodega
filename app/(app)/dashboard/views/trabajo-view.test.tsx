// @vitest-environment jsdom

import * as React from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkTask } from "@/lib/work-queue"
import { TrabajoView } from "./trabajo-view"
import type { DashboardScope } from "../dashboard-scope"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

const tasks: WorkTask[] = [
  {
    id: "approval:req-1",
    type: "approval",
    title: "Revisar SOL-001",
    subtitle: "SOL-001",
    worksiteId: "ws-norte",
    worksiteName: "Faena Norte",
    statusLabel: "Necesita aprobación",
    priority: "critical",
    createdAt: "2026-07-24T10:00:00.000Z",
    href: "/aprobaciones",
    ctaLabel: "Aprobar o devolver",
  },
  {
    id: "receipt:oc-1",
    type: "receipt",
    title: "Recibir en faena OC-001",
    subtitle: "OC-001",
    worksiteId: "ws-sur",
    worksiteName: "Faena Sur",
    statusLabel: "Pendiente de recepción",
    priority: "high",
    createdAt: "2026-07-25T10:00:00.000Z",
    href: "/recepcion/nueva?oc=oc-1",
    ctaLabel: "Recibir en faena",
  },
]

const allWorksitesScope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes", view: "trabajo" }

function renderQueue(props: Partial<React.ComponentProps<typeof TrabajoView>> = {}) {
  return render(
    <TrabajoView
      tasks={tasks}
      queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
      queueShortcuts={[]}
      scope={allWorksitesScope}
      refreshedAt="2026-07-25T12:00:00.000Z"
      {...props}
    />,
  )
}

describe("TrabajoView", () => {
  beforeEach(() => sessionStorage.clear())

  // La faena dejó de filtrar en cliente: la cola llega ya consultada con el
  // alcance global. Filtrar otra vez acá sobre 12 filas sólo podía contradecir
  // los conteos de población completa de los atajos (la causa de D-01).
  it("no vuelve a filtrar por faena en el cliente", () => {
    renderQueue()

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()
    expect(screen.getByText("2 de 2 visibles")).toBeDefined()
  })

  // Regresión D-01: los conteos de los atajos son de población completa; las
  // filas cargadas son sólo las más urgentes. Antes ambos salían de `tasks` y
  // el saludo contradecía a los chips.
  it("anuncia el truncado en vez de pasar la página por la cola entera", () => {
    renderQueue({
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

  it("no anuncia truncado cuando la cola entera cabe", () => {
    renderQueue()

    expect(screen.queryByText(/Mostrando las/)).toBeNull()
  })

  // Sólo el orden queda en sessionStorage; la faena vive en la URL. Una clave
  // vieja con `worksiteId` no debe volver a esconder filas.
  it("restaura el orden persistido y ya no la faena", () => {
    sessionStorage.setItem("dashboard:queue-filters", JSON.stringify({ worksiteId: "ws-sur", sort: "newest" }))
    const { container } = renderQueue()

    // La faena guardada ya no esconde nada: las dos filas siguen ahí.
    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()

    // Pero `sort: "newest"` sí se restaura: la del 25 va antes que la del 24.
    const text = container.textContent ?? ""
    expect(text.indexOf("Recibir en faena OC-001")).toBeLessThan(text.indexOf("Revisar SOL-001"))
  })

  // Regresión C1: la antigüedad se contaba en múltiplos de 24h, así que algo
  // creado ayer a las 23:00 y visto hoy a la 01:00 decía "Hoy".
  it("cuenta la antigüedad en días de calendario chileno, no en bloques de 24h", () => {
    renderQueue({
      // 2026-07-25 23:00 en Chile (UTC-4) = 2026-07-26T03:00Z
      tasks: [{ ...tasks[0]! }].map((task) => ({ ...task, createdAt: "2026-07-26T03:00:00.000Z" })),
      // 2026-07-26 01:00 en Chile = 2026-07-26T05:00Z — dos horas después, otro día
      refreshedAt: "2026-07-26T05:00:00.000Z",
    })

    expect(screen.getByText("1 día")).toBeDefined()
  })

  it("el estado vacío por faena dice cómo salir de él", () => {
    renderQueue({
      tasks: [],
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes", view: "trabajo" },
      queueSummary: { total: 0, critical: 0, overdue: 0, deliveries: 0 },
    })

    expect(screen.getByText("No hay tareas pendientes en este alcance")).toBeDefined()
    expect(screen.getByText(/Cambia de faena arriba para ver otra/)).toBeDefined()
  })
})
