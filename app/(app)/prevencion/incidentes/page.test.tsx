/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): la página llamaba a
 * `getIncidentDashboardCounts(access)` sin filtros, así que las tarjetas contaban
 * todo el alcance aunque la lista estuviera filtrada. Aquí se fija el cableado.
 *
 * Regla A5: el estado son pestañas con contador y las tarjetas son condiciones que
 * cruzan los estados. Cada contador se calcula con los filtros de la URL MENOS su
 * propia dimensión: las pestañas sin el estado (y con la condición activa), las
 * tarjetas sin la condición (y con el estado elegido), la lista con todo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  worksites: vi.fn(),
  counts: vi.fn(),
  statusCounts: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-1", permissions: ["prevention:incidents:view"] } }),
  can: () => false,
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-incidents", () => ({
  listPreventionIncidents: mocks.list,
  listIncidentWorksites: mocks.worksites,
  getIncidentDashboardCounts: mocks.counts,
  getIncidentStatusCounts: mocks.statusCounts,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))
vi.mock("@/components/pwa/re20-pwa-register", () => ({ Re20PwaRegister: () => null }))
vi.mock("./incident-list", () => ({ IncidentList: () => null }))
vi.mock("./public-reports-panel", () => ({ PublicIncidentReportsPanel: () => null }))

import IncidentsPage from "./page"

beforeEach(() => {
  mocks.list.mockResolvedValue([])
  mocks.worksites.mockResolvedValue([])
  mocks.counts.mockResolvedValue({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
  mocks.statusCounts.mockResolvedValue({ total: 0, open: 0, byStatus: {} })
})
afterEach(() => vi.clearAllMocks())

async function renderPage(searchParams: Record<string, string> = {}) {
  await IncidentsPage({ searchParams: Promise.resolve(searchParams) })
  return {
    listFilters: mocks.list.mock.calls[0]![0],
    tileFilters: mocks.counts.mock.calls[0]![1],
    tabFilters: mocks.statusCounts.mock.calls[0]![1],
  }
}

const defined = (filters: Record<string, unknown>) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined))

describe("página de Incidentes — filtros de las pestañas y las tarjetas", () => {
  it("sin filtros en la URL las tres consultas se piden sin filtro (el alcance del usuario)", async () => {
    const { listFilters, tileFilters, tabFilters } = await renderPage()

    expect(defined(tileFilters)).toEqual({})
    expect(defined(tabFilters)).toEqual({})
    expect(defined(listFilters)).toEqual({ access: expect.anything() })
  })

  it("cada contador lleva los filtros de la URL menos su propia dimensión", async () => {
    const { listFilters, tileFilters, tabFilters } = await renderPage({
      worksiteId: "ws-1", year: "2026", monthFrom: "3", monthTo: "5", indicator: "frequency",
      status: "under_investigation", eventType: "work_accident", quick: "overdue",
    })
    const shared = { worksiteId: "ws-1", year: 2026, monthFrom: 3, monthTo: 5, indicator: "frequency", eventType: "work_accident" }

    // La lista filtra por todo, en el servidor.
    expect(defined(listFilters)).toEqual({ access: expect.anything(), ...shared, status: "under_investigation", condition: "overdue" })
    // Las tarjetas (condiciones) cuentan con el estado elegido y sin la condición: son lo que la lista mostraría al activarlas.
    expect(defined(tileFilters)).toEqual({ ...shared, status: "under_investigation" })
    // Las pestañas cuentan sin el estado y con la condición: son lo que la lista mostraría al elegirlas.
    expect(defined(tabFilters)).toEqual({ ...shared, condition: "overdue" })
  })

  it("«todos» (status=all, eventType=all) no filtra", async () => {
    const { listFilters, tileFilters, tabFilters } = await renderPage({ status: "all", eventType: "all" })

    for (const filters of [listFilters, tileFilters, tabFilters]) {
      expect(filters.status).toBeUndefined()
      expect(filters.eventType).toBeUndefined()
    }
  })

  it("«abiertos» es una vista válida del estado", async () => {
    const { listFilters, tileFilters } = await renderPage({ status: "open" })

    expect(listFilters.status).toBe("open")
    expect(tileFilters.status).toBe("open")
  })

  it("un estado o una condición desconocidos se ignoran en vez de llegar crudos al servidor", async () => {
    const { listFilters, tileFilters, tabFilters } = await renderPage({ status: "SUBMITTED", quick: "investigation" })

    for (const filters of [listFilters, tileFilters, tabFilters]) {
      expect(filters.status).toBeUndefined()
      expect(filters.condition).toBeUndefined()
    }
  })

  it("un rango de meses invertido se descarta igual para la lista, las pestañas y las tarjetas", async () => {
    const { listFilters, tileFilters, tabFilters } = await renderPage({ year: "2026", monthFrom: "9", monthTo: "2" })

    for (const filters of [listFilters, tileFilters, tabFilters]) {
      expect(filters.monthFrom).toBeUndefined()
      expect(filters.monthTo).toBeUndefined()
    }
  })
})

describe("página de Incidentes — enlaces del tablero a ?quick=open", () => {
  it("?quick=open (antes una tarjeta) redirige a la pestaña «Abiertos»", async () => {
    await expect(IncidentsPage({ searchParams: Promise.resolve({ quick: "open" }) })).rejects.toThrow("redirect:/prevencion/incidentes?status=open")
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("conserva los demás filtros al redirigir y deja que un estado explícito mande", async () => {
    await expect(IncidentsPage({ searchParams: Promise.resolve({ quick: "open", worksiteId: "ws-1" }) }))
      .rejects.toThrow("redirect:/prevencion/incidentes?worksiteId=ws-1&status=open")
    await expect(IncidentsPage({ searchParams: Promise.resolve({ quick: "open", status: "closed" }) }))
      .rejects.toThrow("redirect:/prevencion/incidentes?status=closed")
  })

  it("las condiciones vigentes no se redirigen", async () => {
    await renderPage({ quick: "fatal" })

    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
})
