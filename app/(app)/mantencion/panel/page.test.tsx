/**
 * «Ver datos» del gráfico semanal del panel ofrece Excel sólo a quien puede exportar mantención
 * (`mant:export`), y el libro dice qué faena y qué ventana miraba la pantalla.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["mant:records:view_all"] as string[] }))
/** Lo que la página sabe de la flota y los registros: con equipos el panel se dibuja, sin ellos es un solo aviso. */
const scope = vi.hoisted(() => ({ activeEquipment: 3, records: 5, workshopRows: 0 }))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/services/mantencion/panel", () => ({
  loadPanelWorksites: async () => [{ id: "ws-1", name: "Biodiversa" }],
  loadPanel: async () => ({
    filters: { period: "30" },
    fleet: { active: scope.activeEquipment, counts: {} },
    records: { total: scope.records },
    workshop: { rows: Array.from({ length: scope.workshopRows }, (_, index) => ({ recordId: `rec-${index}` })) },
    weeks: [{ start: "2026-10-19", preventive: 3, corrective: 1 }, { start: "2026-10-26", preventive: 2, corrective: 0 }],
  }),
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
import { PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelKpis } from "@/components/mantencion/jefatura/panel/panel-kpis"

afterEach(() => {
  session.permissions = ["mant:records:view_all"]
  Object.assign(scope, { activeEquipment: 3, records: 5, workshopRows: 0 })
})

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

describe("/mantencion/panel · sin equipos en el alcance", () => {
  async function page() {
    return MantencionPanelPage({ searchParams: Promise.resolve({}) })
  }

  it("sin equipos, registros ni taller muestra un solo estado vacío y no el panel", async () => {
    Object.assign(scope, { activeEquipment: 0, records: 0, workshopRows: 0 })
    const tree = await page()
    expect(findElement(tree, PanelEmptyState)).not.toBeNull()
    expect(findElement(tree, PanelKpis)).toBeNull()
    expect(findElement(tree, WeeklyCard)).toBeNull()
  })

  it("quien administra equipos recibe la frase de «agrega o importa»; quien sólo mira, no", async () => {
    Object.assign(scope, { activeEquipment: 0, records: 0, workshopRows: 0 })
    expect(findElement(await page(), PanelEmptyState)!.props.canManage).toBe(false)
    session.permissions = ["mant:records:view_all", "mant:equipment:manage"]
    expect(findElement(await page(), PanelEmptyState)!.props.canManage).toBe(true)
  })

  it("con equipos el panel se dibuja completo", async () => {
    const tree = await page()
    expect(findElement(tree, PanelEmptyState)).toBeNull()
    expect(findElement(tree, PanelKpis)).not.toBeNull()
  })

  it("sin flota activa pero con registros o con un equipo detenido, el panel sigue siendo útil", async () => {
    Object.assign(scope, { activeEquipment: 0, records: 2, workshopRows: 0 })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
    Object.assign(scope, { activeEquipment: 0, records: 0, workshopRows: 1 })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
  })
})
