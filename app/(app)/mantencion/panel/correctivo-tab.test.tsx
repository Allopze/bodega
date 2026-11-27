// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MantViewer } from "@/lib/services/mantencion/access"
import type { CorrectivePage, LookerContext, LookerEquipmentOption } from "@/lib/services/mantencion/looker/types"

const mocks = vi.hoisted(() => ({ loadTab: vi.fn(), loadPage: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("pestana=correctivo"),
}))
vi.mock("@/lib/services/mantencion/looker/corrective-tab-data", () => ({ loadCorrectiveTabData: mocks.loadTab }))
vi.mock("@/lib/services/mantencion/looker/corrective", () => ({ loadCorrectivePage: mocks.loadPage }))
vi.mock("@/components/charts/hours-records-combo-chart-lazy", () => ({ HoursRecordsComboChartLazy: () => null }))
vi.mock("@/components/charts/monthly-work-chart-lazy", () => ({ MonthlyWorkChartLazy: () => null }))

import { CorrectivoTab } from "./correctivo-tab"

const VIEWER = { userId: "u-1", email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true } as unknown as MantViewer

const equipment = (id: string, worksiteId: string): LookerEquipmentOption => ({
  id, code: id.toUpperCase(), plate: id.toUpperCase(), label: id, worksiteId, worksiteName: worksiteId, typeName: "Camión", unit: "km",
  scheduleId: null, scheduleName: null, intervals: [], frequency: null,
})

function contextOf(filters: Record<string, unknown> = {}, cross: Record<string, unknown> = {}): LookerContext {
  return {
    filters: {
      tab: "correctivo", unit: "km", from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false,
      worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {}, planningState: null, dateField: "proxima", dateFrom: null,
      dateTo: null, invalidDateRange: false, sheetVehicleId: null, sheetCheckId: null, ...filters,
    },
    options: {
      worksites: [],
      equipment: [equipment("a", "ws-1"), equipment("b", "ws-1"), equipment("c", "ws-2")],
      frequencies: [],
    },
    cross,
  } as unknown as LookerContext
}

const PAGE: CorrectivePage = { rows: [], total: 60, page: 1, pageSize: 25 }

function tabData(over: Record<string, unknown> = {}) {
  return {
    stats: { total: 60, hours: 10, equipment: 2, photoEligible: 10, withoutPhoto: 2 },
    series: [],
    drivers: [],
    monthly: [{ key: "2026-10", label: "oct 2026", count: 60, partial: false }],
    rows: PAGE,
    ...over,
  }
}

async function renderTab(context: LookerContext, rawParams: Record<string, string | string[] | undefined> = { pestana: "correctivo" }) {
  render(await CorrectivoTab({ context, viewer: VIEWER, rawParams }))
}

beforeEach(() => {
  mocks.loadTab.mockReset()
  mocks.loadPage.mockReset()
  mocks.loadTab.mockResolvedValue(tabData())
})
afterEach(cleanup)

describe("pestana Correctivo", () => {
  it("carga la tira, los gráficos y la tabla juntos, con la tabla como página del servidor", async () => {
    const context = contextOf()
    await renderTab(context)
    expect(mocks.loadTab).toHaveBeenCalledTimes(1)
    const [viewer, passed, loadRows] = mocks.loadTab.mock.calls[0]!
    expect(viewer).toBe(VIEWER)
    expect(passed).toBe(context)
    mocks.loadPage.mockResolvedValue(PAGE)
    await loadRows()
    expect(mocks.loadPage).toHaveBeenCalledWith(VIEWER, context.filters, context.cross)
    expect(screen.getByRole("heading", { level: 2, name: "Trabajos del período" })).toBeTruthy()
  })

  it("«de N controlados» cuenta los equipos de la unidad que dejan dentro los filtros de faena y de equipo", async () => {
    await renderTab(contextOf())
    expect(screen.getByText("de 3 controlados")).toBeTruthy()
    cleanup()
    await renderTab(contextOf({ worksiteIds: ["ws-1"] }))
    expect(screen.getByText("de 2 controlados")).toBeTruthy()
    cleanup()
    await renderTab(contextOf({ equipmentIds: ["c"] }))
    expect(screen.getByText("de 1 controlado")).toBeTruthy()
  })

  it("la paginación del servidor conserva los filtros de la URL y cambia sólo la página", async () => {
    mocks.loadTab.mockResolvedValue(tabData({
      rows: {
        rows: [{
          id: "ot:1", source: "ot", date: "2026-10-20", vehicleId: "a", recordId: null, code: "A", plate: "A", typeName: "Camión", unit: "km", reading: null,
          readingText: null, reference: "1", workPerformed: "x", worksiteId: "ws-1", worksiteName: "ws-1", hours: null, photoId: null, photoUrl: null, drivers: [],
        }],
        total: 60,
        page: 1,
        pageSize: 25,
      },
    }))
    await renderTab(contextOf(), { pestana: "correctivo", unidad: "h", x_mes: "2026-10", desde: "2026-10-01" })
    const href = screen.getByRole("link", { name: "Página siguiente" }).getAttribute("href")!
    const params = new URLSearchParams(href.split("?")[1])
    expect(href.startsWith("/mantencion/panel?")).toBe(true)
    expect(params.get("page")).toBe("2")
    expect(params.get("x_mes")).toBe("2026-10")
    expect(params.get("unidad")).toBe("h")
  })
})
