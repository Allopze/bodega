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
// Los cargadores de series quedan como espías: la página debe pasarles la ventana de los gráficos (`chart`).
const loaders = vi.hoisted(() => ({
  series: vi.fn(async (..._args: unknown[]) => [{ key: "2026-10", created: 1, closed: 0, backlog: 1 }]),
  records: vi.fn(async (..._args: unknown[]) => ({ points: [{ key: "2026-10", preventive: scope.records, corrective: 0, partial: false }], preventive: scope.records, preventivePrevious: 0 })),
  outOfService: vi.fn(async (..._args: unknown[]) => ({ points: [], total: 0, totalPrevious: 0 })),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
// El alcance de equipos sale de los permisos, como en el servicio real: `view_all` abre todas las faenas.
vi.mock("@/lib/services/mantencion/access", () => ({
  viewerFromSession: () => ({ userId: "u-1" }),
  equipmentScope: () => (session.permissions.includes("mant:records:view_all") ? "all" : ["ws-1"]),
}))
vi.mock("@/lib/services/mantencion/panel", () => ({
  loadPanelWorksites: async () => [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }],
  countPendingReview: async () => 4,
}))
vi.mock("@/lib/services/mantencion/work-orders/query", () => ({ countUnassignedWorkOrders: unassigned }))
vi.mock("@/lib/services/mantencion/indicators", () => ({
  loadWorkOrderSeries: loaders.series,
  loadWorkOrderPeriodStats: async () => ({}),
  loadOpenWorkOrdersByStatus: async () => [],
  loadTopRepairEquipment: async () => [],
  loadPautaState: async () => ({ counts: {}, total: scope.equipment, inWorkshop: scope.inWorkshop, inWorkshopByOrder: scope.inWorkshop }),
  loadRecordIndicators: loaders.records,
  loadOutOfService: loaders.outOfService,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./indicators-sections", () => ({ WorkOrdersSection: () => null, PautasSection: () => null }))

import MantencionPanelPage from "./page"
import { BoardExportButton } from "@/components/dashboard/board-export-button"
import { BoardHeaderActions } from "@/components/dashboard/board-scope"
import { PageHeader } from "@/components/ui/page-header"
import { PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelToday } from "@/components/mantencion/jefatura/panel/panel-today"
import { WorkOrdersSection } from "./indicators-sections"

afterEach(() => {
  vi.useRealTimers()
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

describe("/mantencion/panel · ventana de los gráficos", () => {
  it("el mes en curso pide las series sobre los seis meses que terminan en él y las secciones reciben el pie de la ventana", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    // Fecha fija: el mes «en curso» se corta en hoy y la ventana se cuenta hacia atrás desde ahí.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-15T15:00:00Z"))
    const tree = await page({ desde: "2026-11-01", hasta: "2026-11-30" })
    const query = loaders.series.mock.calls.at(-1)![1] as { from: string; to: string; chart: { from: string; to: string; granularity: string; isHistory: boolean } }
    // El período sigue siendo el mes (cortado en hoy); la serie mira seis meses, por mes.
    expect(query.from).toBe("2026-11-01")
    expect(query.to).toBe("2026-11-15")
    expect(query.chart).toMatchObject({ granularity: "month", isHistory: true })
    expect(query.chart.from).toBe("2026-06-01")
    expect(query.chart.to).toBe(query.to)
    expect(loaders.records.mock.calls.at(-1)![1]).toMatchObject({ chart: query.chart })
    expect(loaders.outOfService.mock.calls.at(-1)![1]).toMatchObject({ chart: query.chart })
    const props = findElement(tree, WorkOrdersSection)!.props
    expect(props.chart).toMatchObject({ isHistory: true })
    expect(props.chartNote).toMatch(/^Últimos 6 meses, hasta noviembre de 2026 · /)
    expect(String(props.scopeNote)).not.toMatch(/Últimos/)
  })
})

describe("/mantencion/panel · Excel", () => {
  it("la cabecera lleva el control de faena y período; «Exportar Excel» sólo con `mant:export`", async () => {
    const without = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(without, BoardHeaderActions)).not.toBeNull()
    expect(findElement(without, BoardExportButton)).toBeNull()
    session.permissions = ["mant:records:view_all", "mant:export"]
    const actions = findElement(await page({ faena: "ws-1" }), PageHeader)!.props.actions as ReactNode
    expect(findElement(actions, BoardHeaderActions)!.props).toMatchObject({ worksiteId: "ws-1" })
    expect(findElement(actions, BoardExportButton)!.props).toMatchObject({ title: "Panel de mantención", scope: { faena: "Biodiversa" } })
  })
})

describe("/mantencion/panel · rótulo de «todas las faenas»", () => {
  it("quien ve todas las faenas lee «Todas las faenas»; con alcance limitado, «Todas tus faenas»", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    const global = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(global, BoardHeaderActions)!.props.allLabel).toBe("Todas las faenas")
    session.permissions = ["mant:records:view_worksite", "mant:export"]
    const limited = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(limited, BoardHeaderActions)!.props.allLabel).toBe("Todas tus faenas")
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
