/**
 * «Ver datos» del gráfico semanal del panel ofrece Excel sólo a quien puede exportar mantención
 * (`mant:export`), y el libro dice qué faena y qué ventana miraba la pantalla.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["mant:records:view_all"] as string[] }))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/services/mantencion/panel", () => ({
  loadPanelWorksites: async () => [{ id: "ws-1", name: "Biodiversa" }],
  loadPanel: async () => ({ filters: { period: "30" }, weeks: [{ start: "2026-10-19", preventive: 3, corrective: 1 }, { start: "2026-10-26", preventive: 2, corrective: 0 }] }),
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))
vi.mock("@/components/mantencion/jefatura/panel/panel-filters-bar", () => ({ PanelFiltersBar: () => null }))
vi.mock("@/components/mantencion/jefatura/panel/panel-kpis", () => ({ PanelKpis: () => null, PanelStrip: () => null }))
vi.mock("@/components/mantencion/jefatura/panel/panel-cards", () => ({
  FleetCard: () => null, HoursCard: () => null, NotDoneCard: () => null, UpcomingCard: () => null, WeeklyCard: () => null, WorkshopCard: () => null,
}))
vi.mock("./panel-export-button", () => ({ PanelExportButton: () => null }))

import MantencionPanelPage from "./page"
import { WeeklyCard } from "@/components/mantencion/jefatura/panel/panel-cards"

afterEach(() => { session.permissions = ["mant:records:view_all"] })

function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as { props: Record<string, unknown> }
  const children = (node.props as { children?: ReactNode }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child as ReactNode, type)
    if (found) return found
  }
  return null
}

async function weeklyCard(searchParams: Record<string, string> = {}) {
  const tree = await MantencionPanelPage({ searchParams: Promise.resolve(searchParams) })
  const card = findElement(tree, WeeklyCard)
  if (!card) throw new Error("no se encontró el gráfico semanal")
  return card
}

describe("/mantencion/panel · «Ver datos» → Excel", () => {
  it("quien sólo puede ver el panel no recibe la descarga", async () => {
    expect((await weeklyCard()).props.excel).toBeUndefined()
  })

  it("con `mant:export` ofrece Excel y declara el alcance en «Metadatos»", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    expect((await weeklyCard()).props.excel).toEqual({
      permission: "mant:export",
      notes: ["Últimas 2 semanas · todas las faenas del alcance."],
    })
  })

  it("con una faena elegida el libro dice cuál", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    const excel = (await weeklyCard({ faena: "ws-1" })).props.excel as { notes: string[] }
    expect(excel.notes).toEqual(["Últimas 2 semanas · Biodiversa."])
  })
})
