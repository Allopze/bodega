// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
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

describe("DashboardControlCenter", () => {
  it("filters the queue through the priority quick filter", () => {
    render(
      <DashboardControlCenter
        firstName="Ana"
        contextLabel="Faenas autorizadas"
        refreshedAt="2026-07-25T12:00:00.000Z"
        tasks={tasks}
        queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
        canAssign={false}
        periodSummary={[]}
        backlogSummary={[]}
        metrics={[]}
        alerts={[]}
      />,
    )

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.getByText("Recibir en faena OC-001")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /Críticas\s*1/i }))

    expect(screen.getByText("Revisar SOL-001")).toBeDefined()
    expect(screen.queryByText("Recibir en faena OC-001")).toBeNull()
    expect(screen.getByText("1 de 2 tareas")).toBeDefined()
  })

  it("uses the complete authorized queue for the contextual summary", () => {
    render(
      <DashboardControlCenter
        firstName="Ana"
        contextLabel="Faenas autorizadas"
        refreshedAt="2026-07-25T12:00:00.000Z"
        tasks={tasks}
        queueSummary={{ total: 39, critical: 4, overdue: 3, deliveries: 2 }}
        canAssign={false}
        periodSummary={[]}
        backlogSummary={[]}
        metrics={[]}
        alerts={[]}
      />,
    )

    expect(screen.getByText(/39 tareas pendientes, 4 críticas, 3 vencidas, 2 entregas por registrar/i)).toBeDefined()
  })

  it("keeps an honest period comparison in the compact flow summary", () => {
    render(
      <DashboardControlCenter
        firstName="Ana"
        contextLabel="Faenas autorizadas"
        refreshedAt="2026-07-25T12:00:00.000Z"
        tasks={tasks}
        queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
        canAssign={false}
        periodSummary={[
          { key: "requests", label: "Solicitudes creadas", value: 7, comparison: "+2 vs. mes anterior", href: "/solicitudes" },
          { key: "orders", label: "OC emitidas", value: 0, comparison: "Sin período comparable", href: "/compras" },
        ]}
        backlogSummary={[]}
        metrics={[]}
        alerts={[]}
      />,
    )

    expect(screen.getByRole("link", { name: /Solicitudes creadas: 7.*\+2 vs\. mes anterior/i })).toHaveAttribute("href", "/solicitudes")
    expect(screen.getByText("Sin período comparable")).toBeDefined()
  })

  it("shows backlog only with its real snapshot state", () => {
    render(
      <DashboardControlCenter
        firstName="Ana"
        contextLabel="Faenas autorizadas"
        refreshedAt="2026-07-25T12:00:00.000Z"
        tasks={tasks}
        queueSummary={{ total: 2, critical: 1, overdue: 0, deliveries: 0 }}
        canAssign={false}
        periodSummary={[]}
        backlogSummary={[
          { key: "backlog_requests", label: "Solicitudes activas", value: 4, comparison: "Sin snapshot completo previo", href: "/pendientes?module=solicitudes" },
        ]}
        metrics={[]}
        alerts={[]}
      />,
    )

    expect(screen.getByRole("link", { name: /Solicitudes activas: 4.*Sin snapshot completo previo/i })).toHaveAttribute("href", "/pendientes?module=solicitudes")
  })
})
