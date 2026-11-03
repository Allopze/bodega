/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): la página llamaba a
 * `getCapaDashboardCounts(access)` sin filtros, así que las tarjetas contaban
 * todo el alcance aunque la lista estuviera filtrada por faena, fuente o estado.
 * Aquí se fija el cableado: las tarjetas reciben los filtros de servidor de la
 * URL; el filtro rápido (`vista`) —la tarjeta misma— sólo lo recibe la lista.
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
  requirePermission: async () => ({ user: { id: "u-1", permissions: ["prevention:capa:view"] } }),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-capa", () => ({
  listCapaActionsPage: mocks.list,
  listCapaWorksites: mocks.worksites,
  getCapaDashboardCounts: mocks.counts,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./capa-list", () => ({ CapaList: () => null }))
vi.mock("./manual-capa-dialog", () => ({ ManualCapaDialog: () => null }))

import CapaPage from "./page"

beforeEach(() => {
  mocks.list.mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 })
  mocks.worksites.mockResolvedValue([])
  mocks.counts.mockResolvedValue({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
})
afterEach(() => vi.clearAllMocks())

async function renderPage(searchParams: Record<string, string> = {}) {
  await CapaPage({ searchParams: Promise.resolve(searchParams) })
  return { listArgs: mocks.list.mock.calls[0]![0], countArgs: mocks.counts.mock.calls[0]![0] }
}

describe("página de CAPA — filtros de las tarjetas", () => {
  it("sin filtros en la URL las tarjetas se piden sin filtro (el alcance del usuario)", async () => {
    const { countArgs } = await renderPage()

    expect(countArgs.scope).toEqual({ mode: "some", ids: ["ws-1"] })
    expect(countArgs.status).toBeUndefined()
    expect(countArgs.sourceType).toBeUndefined()
    expect(countArgs.worksiteId).toBeUndefined()
  })

  it("las tarjetas reciben faena, fuente y estado, igual que la lista", async () => {
    const { listArgs, countArgs } = await renderPage({ status: "in_progress", source: "inspection", worksite: "ws-1", vista: "overdue" })

    expect(countArgs).toMatchObject({ status: "in_progress", sourceType: "inspection", worksiteId: "ws-1" })
    expect(listArgs).toMatchObject({ status: "in_progress", sourceType: "inspection", worksiteId: "ws-1", quickFilter: "overdue" })
    // La vista es la tarjeta misma: no se le pasa a las tarjetas.
    expect(countArgs.quickFilter).toBeUndefined()
  })

  it("«todos» (all) no filtra", async () => {
    const { countArgs } = await renderPage({ status: "all", source: "all", worksite: "all" })

    expect(countArgs.status).toBeUndefined()
    expect(countArgs.sourceType).toBeUndefined()
    expect(countArgs.worksiteId).toBeUndefined()
  })
})
