/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): la página llamaba a
 * `getIncidentDashboardCounts(access)` sin filtros, así que las tarjetas contaban
 * todo el alcance aunque la lista estuviera filtrada. Aquí se fija el cableado:
 * las tarjetas reciben los filtros de la URL; el filtro rápido (`quick`) no.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  worksites: vi.fn(),
  counts: vi.fn(),
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
})
afterEach(() => vi.clearAllMocks())

async function renderPage(searchParams: Record<string, string> = {}) {
  await IncidentsPage({ searchParams: Promise.resolve(searchParams) })
  return { listFilters: mocks.list.mock.calls[0]![0], countFilters: mocks.counts.mock.calls[0]![1] }
}

describe("página de Incidentes — filtros de las tarjetas", () => {
  it("sin filtros en la URL las tarjetas se piden sin filtro (el alcance del usuario)", async () => {
    const { countFilters } = await renderPage()

    expect(Object.values(countFilters).filter((value) => value !== undefined)).toEqual([])
  })

  it("las tarjetas reciben los mismos filtros de servidor que la lista, más estado y tipo", async () => {
    const { listFilters, countFilters } = await renderPage({
      worksiteId: "ws-1", year: "2026", monthFrom: "3", monthTo: "5", indicator: "frequency",
      status: "under_investigation", eventType: "work_accident", quick: "open",
    })

    expect(listFilters).toMatchObject({ worksiteId: "ws-1", year: 2026, monthFrom: 3, monthTo: 5, indicator: "frequency" })
    expect(countFilters).toEqual({
      worksiteId: "ws-1", year: 2026, monthFrom: 3, monthTo: 5, indicator: "frequency",
      status: "under_investigation", eventType: "work_accident",
    })
    // El filtro rápido es la tarjeta misma: no se le pasa a ninguna de las dos consultas.
    expect(JSON.stringify(countFilters)).not.toContain("quick")
    expect(JSON.stringify(listFilters)).not.toContain("quick")
  })

  it("«todos» (status=all, eventType=all) no filtra", async () => {
    const { countFilters } = await renderPage({ status: "all", eventType: "all" })

    expect(countFilters.status).toBeUndefined()
    expect(countFilters.eventType).toBeUndefined()
  })

  it("un rango de meses invertido se descarta igual para la lista y las tarjetas", async () => {
    const { listFilters, countFilters } = await renderPage({ year: "2026", monthFrom: "9", monthTo: "2" })

    expect(listFilters.monthFrom).toBeUndefined()
    expect(countFilters.monthFrom).toBeUndefined()
    expect(countFilters.monthTo).toBeUndefined()
  })
})
