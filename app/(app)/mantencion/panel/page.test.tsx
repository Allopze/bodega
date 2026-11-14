/**
 * El Panel de mantención es los Indicadores con la franja «Hoy» arriba (decisión del usuario
 * 2026-11-14). Se prueba el cableado de la página: qué se consulta según los permisos, el
 * estado vacío único y el Excel sólo con `mant:export`.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["mant:records:view_all"] as string[] }))
const scope = vi.hoisted(() => ({ equipment: 3, records: 5, inWorkshop: 1 }))
const unassigned = vi.hoisted(() => vi.fn(async () => 2))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/services/mantencion/access", () => ({ viewerFromSession: () => ({ userId: "u-1" }) }))
vi.mock("@/lib/services/mantencion/panel", () => ({
  loadPanelWorksites: async () => [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }],
  countPendingReview: async () => 4,
}))
vi.mock("@/lib/services/mantencion/work-orders/query", () => ({ countUnassignedWorkOrders: unassigned }))
vi.mock("@/lib/services/mantencion/indicators", () => ({
  loadWorkOrderSeries: async () => [{ key: "2026-10", created: 1, closed: 0, backlog: 1 }],
  loadWorkOrderPeriodStats: async () => ({}),
  loadOpenWorkOrdersByStatus: async () => [],
  loadTopRepairEquipment: async () => [],
  loadPautaState: async () => ({ counts: {}, total: scope.equipment, inWorkshop: scope.inWorkshop }),
  loadRecordIndicators: async () => ({ points: [{ key: "2026-10", preventive: scope.records, corrective: 0, partial: false }], preventive: scope.records, preventivePrevious: 0 }),
  loadOutOfService: async () => ({ points: [], total: 0, previous: 0 }),
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/dashboard/indicator-filters", () => ({ IndicatorFilters: () => null }))
vi.mock("./indicators-sections", () => ({ WorkOrdersSection: () => null, PautasSection: () => null }))
vi.mock("./panel-export-button", () => ({ PanelExportButton: () => null }))

import MantencionPanelPage from "./page"
import { PageHeader } from "@/components/ui/page-header"
import { PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelToday } from "@/components/mantencion/jefatura/panel/panel-today"
import { WorkOrdersSection } from "./indicators-sections"
import { PanelExportButton } from "./panel-export-button"

afterEach(() => {
  session.permissions = ["mant:records:view_all"]
  Object.assign(scope, { equipment: 3, records: 5, inWorkshop: 1 })
  unassigned.mockClear()
})

type Found = { props: Record<string, unknown> }
function findElement(node: ReactNode, type: unknown): Found | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child as ReactNode, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as Found
  return findElement((node.props as { children?: ReactNode }).children, type)
}

const page = (searchParams: Record<string, string> = {}) => MantencionPanelPage({ searchParams: Promise.resolve(searchParams) })

describe("/mantencion/panel · franja «Hoy» y gráficos", () => {
  it("con permiso de órdenes la franja trae las órdenes por asignar y se pintan los gráficos de OT", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    const tree = await page()
    expect(findElement(tree, PanelToday)!.props).toMatchObject({ unassignedOrders: 2, inWorkshop: 1, pendingReview: 4, worksiteId: null })
    expect(findElement(tree, WorkOrdersSection)).not.toBeNull()
  })

  it("sin permiso de órdenes no se consultan ni se ofrecen", async () => {
    const tree = await page()
    expect(unassigned).not.toHaveBeenCalled()
    expect(findElement(tree, PanelToday)!.props.unassignedOrders).toBeNull()
    expect(findElement(tree, WorkOrdersSection)).toBeNull()
  })

  it("la faena elegida acota la franja; una faena fuera del alcance se ignora", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    expect(findElement(await page({ faena: "ws-2" }), PanelToday)!.props.worksiteId).toBe("ws-2")
    expect(unassigned).toHaveBeenLastCalledWith(expect.anything(), "ws-2")
    expect(findElement(await page({ faena: "otra" }), PanelToday)!.props.worksiteId).toBeNull()
  })
})

describe("/mantencion/panel · Excel", () => {
  it("sólo con `mant:export`, y con la faena elegida", async () => {
    expect(findElement(await page(), PageHeader)!.props.actions).toBeUndefined()
    session.permissions = ["mant:records:view_all", "mant:export"]
    const actions = findElement(await page({ faena: "ws-1" }), PageHeader)!.props.actions as ReactNode
    expect(findElement(actions, PanelExportButton)!.props.params).toEqual({ faena: "ws-1" })
  })
})

describe("/mantencion/panel · sin equipos en el alcance", () => {
  it("sin equipos ni registros muestra un solo estado vacío y no la franja ni los gráficos", async () => {
    Object.assign(scope, { equipment: 0, records: 0, inWorkshop: 0 })
    const tree = await page()
    expect(findElement(tree, PanelEmptyState)).not.toBeNull()
    expect(findElement(tree, PanelToday)).toBeNull()
  })

  it("con registros el panel se dibuja aunque la flota activa sea cero", async () => {
    Object.assign(scope, { equipment: 0, records: 2, inWorkshop: 0 })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
  })
})
