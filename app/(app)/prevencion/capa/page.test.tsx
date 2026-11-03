/**
 * Fase 0.7 (AUDITORIA_VISUALIZACIONES_CHOME): la página llamaba a
 * `getCapaDashboardCounts(access)` sin filtros, así que las tarjetas contaban
 * todo el alcance aunque la lista estuviera filtrada por faena, fuente o estado.
 * Aquí se fija el cableado.
 *
 * Regla A5: el estado son pestañas con contador y las tarjetas son condiciones que
 * cruzan los estados (`vista`). Cada contador se calcula con los filtros de la URL
 * MENOS su propia dimensión: las pestañas sin el estado (y con la condición activa),
 * las tarjetas sin la condición (y con el estado elegido), la lista con todo.
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
  requirePermission: async () => ({ user: { id: "u-1", permissions: ["prevention:capa:view"] } }),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-capa", () => ({
  listCapaActionsPage: mocks.list,
  listCapaWorksites: mocks.worksites,
  getCapaDashboardCounts: mocks.counts,
  getCapaStatusCounts: mocks.statusCounts,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./capa-list", () => ({ CapaList: () => null }))
vi.mock("./manual-capa-dialog", () => ({ ManualCapaDialog: () => null }))

import CapaPage from "./page"

beforeEach(() => {
  mocks.list.mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 })
  mocks.worksites.mockResolvedValue([])
  mocks.counts.mockResolvedValue({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 })
  mocks.statusCounts.mockResolvedValue({ total: 0, open: 0, byStatus: {} })
})
afterEach(() => vi.clearAllMocks())

async function renderPage(searchParams: Record<string, string> = {}) {
  await CapaPage({ searchParams: Promise.resolve(searchParams) })
  return {
    listArgs: mocks.list.mock.calls[0]![0],
    tileArgs: mocks.counts.mock.calls[0]![0],
    tabArgs: mocks.statusCounts.mock.calls[0]![0],
  }
}

const SCOPE = { mode: "some", ids: ["ws-1"] }

describe("página de CAPA — filtros de las pestañas y las tarjetas", () => {
  it("sin filtros en la URL las tarjetas y las pestañas se piden sin filtro (el alcance del usuario)", async () => {
    const { tileArgs, tabArgs } = await renderPage()

    for (const args of [tileArgs, tabArgs]) {
      expect(args.scope).toEqual(SCOPE)
      expect(args.status).toBeUndefined()
      expect(args.sourceType).toBeUndefined()
      expect(args.worksiteId).toBeUndefined()
      expect(args.quickFilter).toBeUndefined()
    }
  })

  it("cada contador lleva los filtros de la URL menos su propia dimensión", async () => {
    const { listArgs, tileArgs, tabArgs } = await renderPage({ status: "in_progress", source: "inspection", worksite: "ws-1", vista: "overdue" })

    // La lista filtra por todo.
    expect(listArgs).toMatchObject({ status: "in_progress", sourceType: "inspection", worksiteId: "ws-1", quickFilter: "overdue" })
    // Las tarjetas (condiciones) cuentan con el estado elegido y sin la condición: son lo que la lista mostraría al activarlas.
    expect(tileArgs).toMatchObject({ status: "in_progress", sourceType: "inspection", worksiteId: "ws-1" })
    expect(tileArgs.quickFilter).toBeUndefined()
    // Las pestañas cuentan sin el estado y con la condición: son lo que la lista mostraría al elegirlas.
    expect(tabArgs).toMatchObject({ sourceType: "inspection", worksiteId: "ws-1", quickFilter: "overdue" })
    expect(tabArgs.status).toBeUndefined()
  })

  it("«todos» (all) no filtra", async () => {
    const { tileArgs, tabArgs } = await renderPage({ status: "all", source: "all", worksite: "all" })

    for (const args of [tileArgs, tabArgs]) {
      expect(args.status).toBeUndefined()
      expect(args.sourceType).toBeUndefined()
      expect(args.worksiteId).toBeUndefined()
    }
  })

  it("«abiertas» es una vista válida del estado", async () => {
    const { listArgs, tileArgs } = await renderPage({ status: "open" })

    expect(listArgs.status).toBe("open")
    expect(tileArgs.status).toBe("open")
  })

  it("un estado o una condición desconocidos se ignoran en vez de llegar crudos al servidor", async () => {
    const { listArgs, tileArgs, tabArgs } = await renderPage({ status: "IN_PROGRESS", vista: "everything" })

    for (const args of [listArgs, tileArgs, tabArgs]) {
      expect(args.status).toBeUndefined()
      expect(args.quickFilter).toBeUndefined()
    }
  })

  it("la paginación recorta sólo la lista, no los contadores", async () => {
    const { listArgs, tileArgs, tabArgs } = await renderPage({ page: "3" })

    expect(listArgs.offset).toBe(100)
    expect(tileArgs.offset).toBeUndefined()
    expect(tabArgs.offset).toBeUndefined()
  })
})

describe("página de CAPA — enlaces a ?vista= que ahora son una pestaña", () => {
  it("?vista=open y ?vista=pending_verification redirigen a la pestaña del estado y conservan los demás filtros", async () => {
    await expect(CapaPage({ searchParams: Promise.resolve({ vista: "open" }) })).rejects.toThrow("redirect:/prevencion/capa?status=open")
    await expect(CapaPage({ searchParams: Promise.resolve({ vista: "pending_verification", worksite: "ws-1" }) }))
      .rejects.toThrow("redirect:/prevencion/capa?worksite=ws-1&status=pending_verification")
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("el enlace del tablero a «vencidas» sigue siendo una condición y no se redirige", async () => {
    const { listArgs } = await renderPage({ vista: "overdue" })

    expect(listArgs.quickFilter).toBe("overdue")
  })
})
