// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MantViewer } from "@/lib/services/mantencion/access"
import type { EquipmentCheckDetail } from "@/lib/services/mantencion/looker/equipment-check-summary"
import type {
  ChecklistMatrix, ComplianceByPlate, LookerContext, MatrixCheck, PreventiveCompliance,
} from "@/lib/services/mantencion/looker/types"

const data = vi.hoisted(() => ({ tab: vi.fn(), detail: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams("pestana=preventivo"),
}))
vi.mock("@/lib/services/mantencion/looker/work-data", () => ({ loadPreventiveTabData: data.tab }))
vi.mock("@/lib/services/mantencion/looker/equipment-check-detail", () => ({ loadEquipmentCheckDetail: data.detail }))
// Recharts se carga diferido y su dibujo tiene su propia prueba: aquí sólo importa qué se le entrega.
vi.mock("@/components/charts/monthly-compliance-chart-lazy", () => ({
  MonthlyComplianceChartLazy: ({ data: months, ariaLabel }: { data: Array<{ key: string; percent: number | null }>; ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel}>{months.map((month) => `${month.key}:${month.percent}`).join(",")}</div>
  ),
}))

import { PreventivoTab } from "./preventivo-tab"

const VIEWER = { userId: "u-1", email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true } as unknown as MantViewer
const context = (over: { sheetVehicleId?: string | null; sheetCheckId?: string | null } = {}) => ({
  filters: {
    tab: "preventivo", unit: "km", from: "2026-10-01", to: "2026-12-31", requestedFrom: "2026-10-01", requestedTo: "2026-12-31", invalidPeriod: false,
    worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {}, sheetVehicleId: null, sheetCheckId: null, ...over,
  },
  options: { worksites: [], equipment: [], frequencies: [] },
  cross: {},
}) as unknown as LookerContext

const plate = (over: Partial<ComplianceByPlate>): ComplianceByPlate => ({
  vehicleId: "v-1", code: "KA-F1", plate: "FICHA-01", worksiteId: "ws-1", worksiteName: "Faena A", percent: 80, checks: 2, levels: ["40.000 KM"],
  notDone: 3, lastDate: "2026-12-10", lastMechanic: "Javier Roa", withoutPhotos: 1, ...over,
})
const compliance = (over: Partial<PreventiveCompliance> = {}): PreventiveCompliance => ({
  checks: [], byMonth: [], byWorksiteMechanic: [], byPlate: [], average: null, total: 0, notDone: 0, withoutPhotos: 0, ...over,
})
const matrixCheck: MatrixCheck = {
  id: "h:p1", source: "historial", vehicleId: "v-1", date: "2026-10-15", label: "KA-F1 · 40.000 KM", code: "KA-F1", plate: "FICHA-01",
  worksiteName: "Faena A", level: "40.000 KM", mechanic: "Javier Roa", photoIds: [], photoUrls: [], observations: null,
  items: { "Cambio aceite": "realizado" }, itemOrder: { "Cambio aceite": 0 }, itemGroups: { "Cambio aceite": null },
}
const matrix: ChecklistMatrix = { checks: [matrixCheck], items: [{ name: "Cambio aceite", group: null, sortOrder: 0 }], withoutDetail: 0 }

function tabData() {
  const summary = compliance({ total: 5, average: 94.25, notDone: 7, withoutPhotos: 2 })
  return {
    summary,
    monthly: compliance({ byMonth: [{ key: "2026-10", label: "oct 2026", percent: 96, checks: 3 }, { key: "2026-11", label: "nov 2026", percent: null, checks: 0 }] }),
    byWorksite: compliance({
      byWorksiteMechanic: [
        { key: "ws-1|a", label: "Faena A · Ana", percent: 70, checks: 2, worksiteId: "ws-1", worksiteName: "Faena A", mechanicKey: "ana", mechanicLabel: "Ana" },
        { key: "ws-2|b", label: "Faena B · Beto", percent: 99, checks: 1, worksiteId: "ws-2", worksiteName: "Faena B", mechanicKey: "beto", mechanicLabel: "Beto" },
      ],
    }),
    byPlate: compliance({
      byPlate: [
        plate({}),
        plate({ vehicleId: "v-2", code: "KA-F2", plate: "FICHA-02", notDone: 0, percent: 100, withoutPhotos: 0, lastMechanic: null }),
        plate({ vehicleId: null, code: "KA-X", plate: "", worksiteName: null, notDone: 0, percent: null, withoutPhotos: 0 }),
      ],
    }),
    matrix,
  }
}

const DETAIL: EquipmentCheckDetail = {
  vehicle: { id: "v-1", code: "KA-F1", plate: "FICHA-01", typeName: "Camión", worksiteName: "Faena A" },
  period: { from: "2026-10-01", to: "2026-12-31" },
  checks: [{ id: "h:p1", source: "historial", date: "2026-10-15", level: "40.000 KM", mechanic: "Javier Roa", done: 1, notDone: 0, notApplicable: 0, percent: 100, folio: null, recordId: null }],
  pending: [],
  selected: {
    id: "h:p1", source: "historial", date: "2026-10-15", level: "40.000 KM", mechanic: "Javier Roa", done: 1, notDone: 0, notApplicable: 0, percent: 100,
    folio: null, recordId: null, reading: null, observations: null, itemDetail: "full",
    items: [{ name: "Cambio aceite", system: null, state: "realizado", reason: null }],
    filtersPhoto: { status: "missing" }, stickerPhoto: { status: "missing" },
  },
}

const render_ = async (over: Parameters<typeof context>[0] = {}, raw: Record<string, string> = { pestana: "preventivo" }) =>
  render(await PreventivoTab({ context: context(over), viewer: VIEWER, rawParams: raw }))

beforeEach(() => { data.tab.mockReset(); data.detail.mockReset(); data.tab.mockResolvedValue(tabData()); data.detail.mockResolvedValue(DETAIL) })
afterEach(cleanup)

describe("pestaña Preventivo", () => {
  it("abre con la tira de cifras del período: pautas, cumplimiento, ítems no realizados y pautas con fotos incompletas", async () => {
    await render_()
    const strip = screen.getByText("Pautas cerradas").closest("div.overflow-hidden")!
    const cells = Array.from(strip.querySelectorAll(":scope > div > div")).map((cell) => cell.textContent)
    expect(cells).toEqual([
      "Pautas cerradas5en el período",
      "Cumplimiento promedio94,3%promedio de los % de cada pauta",
      "Ítems no realizados7suma de todas las pautas",
      "Pautas con fotos incompletas2filtros o sticker faltante",
    ])
  })

  it("tres preguntas como h2 y ninguna ficha ni consulta de detalle sin `ficha`", async () => {
    await render_()
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "¿Se cumplen las pautas?", "Cumplimiento por equipo", "¿Qué se hizo en cada pauta?",
    ])
    expect(screen.getByText("Clic en un mes o en una faena filtra la tabla y el checklist.")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(data.detail).not.toHaveBeenCalled()
  })

  it("el gráfico mensual recibe todos los meses (el sin pautas queda como hueco) y la faena va con el menor cumplimiento primero", async () => {
    await render_()
    expect(screen.getByRole("img", { name: "Cumplimiento por mes" }).textContent).toBe("2026-10:96,2026-11:null")
    const bars = within(screen.getByRole("group", { name: "Cumplimiento por faena y mecánico" })).getAllByRole("button")
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual(["Faena A · Ana: 70%", "Faena B · Beto: 99%"])
  })

  it("la tabla por equipo trae las columnas nuevas, el equipo con más sin hacer primero y la patente que abre la ficha", async () => {
    await render_()
    const table = screen.getByRole("table", { name: "Cumplimiento por equipo" })
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "Equipo", "Niveles de pauta", "Cumplimiento", "Pautas", "Sin hacer", "Última pauta", "Fotos completas",
    ])
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByRole("link", { name: "FICHA-01" }).getAttribute("href")).toBe("/mantencion/panel?pestana=preventivo&ficha=v-1")
    expect(rows[0]!.textContent).toContain("1 sin fotos")
    expect(rows[0]!.textContent).toContain("10-12-2026")
    expect(rows[0]!.textContent).toContain("Javier Roa")
    expect(rows[1]!.textContent).toContain("Todas")
    // El equipo sin vincular no es un enlace ni se puede filtrar.
    expect(within(rows[2]!).queryByRole("link")).toBeNull()
    expect(within(rows[2]!).queryByRole("button", { name: /Filtrar el panel por/ })).toBeNull()
  })

  it("filtrar y abrir son dos controles: el embudo filtra por el equipo y la patente navega a su ficha", async () => {
    await render_()
    const row = within(screen.getByRole("table", { name: "Cumplimiento por equipo" })).getAllByRole("row")[1]!
    expect(within(row).getByRole("button", { name: "Filtrar el panel por FICHA-01" }).getAttribute("aria-pressed")).toBe("false")
    expect(within(row).getByRole("link", { name: "FICHA-01" }).closest("button")).toBeNull()
  })

  it("el encabezado de cada columna de la matriz abre la ficha en esa pauta y el embudo filtra por ella", async () => {
    await render_()
    const matrixTable = screen.getByRole("table", { name: "Matriz de checklist de pautas" })
    const header = within(matrixTable).getAllByRole("columnheader")[1]!
    expect(within(header).getByRole("link", { name: "FICHA-01" }).getAttribute("href")).toBe("/mantencion/panel?pestana=preventivo&ficha=v-1&pauta=h%3Ap1")
    expect(within(header).getByRole("button", { name: /Filtrar el panel por la pauta del 15-10-2026/ })).toBeTruthy()
  })
})

describe("pestaña Preventivo · ficha", () => {
  it("con `ficha` carga el detalle con el período del panel y la pauta de la URL, y abre el modal", async () => {
    await render_({ sheetVehicleId: "v-1", sheetCheckId: "h:p1" }, { pestana: "preventivo", ficha: "v-1", pauta: "h:p1" })
    expect(data.detail).toHaveBeenCalledWith(VIEWER, "v-1", { from: "2026-10-01", to: "2026-12-31" }, "h:p1")
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "FICHA-01" })).toBeTruthy()
    // El pie lleva al historial del equipo, de preventivas y con el período del panel.
    const history = within(dialog).getByRole("link", { name: "Historial del equipo" }).getAttribute("href")!
    expect(history).toContain("/mantencion/registros/historicos?")
    expect(history).toContain("equipo=v-1")
    expect(history).toContain("tipo=preventiva")
    expect(history).toContain("desde=2026-10-01")
    expect(history).toContain("hasta=2026-12-31")
    // El formulario histórico no tiene página propia de pauta: sin enlace al registro.
    expect(within(dialog).queryByRole("link", { name: /Ver el registro/ })).toBeNull()
  })

  it("un equipo que no se puede ver abre el modal en su estado «no disponible»", async () => {
    data.detail.mockResolvedValue(null)
    await render_({ sheetVehicleId: "v-9" }, { pestana: "preventivo", ficha: "v-9" })
    expect(screen.getByRole("heading", { name: "Equipo no disponible" })).toBeTruthy()
  })
})
