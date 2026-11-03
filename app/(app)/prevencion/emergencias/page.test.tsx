/**
 * Regresión: la página calculaba el desplazamiento de la lista de planes con
 * `resolvePagination({ totalItems: 0 })`. Con total 0 la página se recorta a la 1,
 * así que `?page=2` (y cualquier otra) mostraba siempre los primeros 50 planes
 * mientras el paginador decía «Página 2». El desplazamiento sale del parámetro y
 * la paginación del paginador se resuelve con el total que devuelve el servicio.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  plans: vi.fn(),
  drills: vi.fn(),
  worksites: vi.fn(),
  counts: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-1", permissions: ["prevention:emergency:view"] } }),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-emergency", () => ({
  listEmergencyPlansPage: mocks.plans,
  listEmergencyDrills: mocks.drills,
  listEmergencyWorksites: mocks.worksites,
  getEmergencyDashboardCounts: mocks.counts,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./emergencias-dialogs", () => ({ NewPlanDialog: () => null }))
vi.mock("./emergency-list", () => ({ EmergencyList: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))

import EmergenciasPage from "./page"
import { EmergencyList } from "./emergency-list"

beforeEach(() => {
  mocks.plans.mockResolvedValue({ rows: [], total: 120, limit: 50, offset: 0 })
  mocks.drills.mockResolvedValue([])
  mocks.worksites.mockResolvedValue([])
  mocks.counts.mockResolvedValue({})
})
afterEach(() => vi.clearAllMocks())

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

async function renderPage(searchParams: Record<string, string> = {}) {
  const tree = await EmergenciasPage({ searchParams: Promise.resolve(searchParams) })
  const list = findElement(tree, EmergencyList)
  if (!list) throw new Error("no se encontró el listado de planes")
  return {
    plansArgs: mocks.plans.mock.calls[0]![1] as { limit: number; offset: number },
    pagination: list.props.plansPagination as { page: number; totalPages: number; totalItems: number },
  }
}

describe("página de emergencias — paginación de planes", () => {
  it("sin ?page= pide la primera página", async () => {
    const { plansArgs, pagination } = await renderPage()

    expect(plansArgs).toMatchObject({ limit: 50, offset: 0 })
    expect(pagination).toMatchObject({ page: 1, totalPages: 3, totalItems: 120 })
  })

  it("?page=2 pide el desplazamiento de la segunda página y no la primera", async () => {
    const { plansArgs, pagination } = await renderPage({ page: "2" })

    expect(plansArgs.offset).toBe(50)
    expect(pagination.page).toBe(2)
  })

  it("?page=3 pide los planes 101 a 120", async () => {
    const { plansArgs, pagination } = await renderPage({ page: "3" })

    expect(plansArgs.offset).toBe(100)
    expect(pagination.page).toBe(3)
  })

  it("un parámetro inválido o menor que 1 cae en la primera página", async () => {
    for (const page of ["x", "0", "-4"]) {
      mocks.plans.mockClear()
      const { plansArgs } = await renderPage({ page })
      expect(plansArgs.offset).toBe(0)
    }
  })

  it("una página fuera de rango se muestra como la última en el paginador", async () => {
    const { pagination } = await renderPage({ page: "99" })

    expect(pagination).toMatchObject({ page: 3, totalPages: 3 })
  })
})
