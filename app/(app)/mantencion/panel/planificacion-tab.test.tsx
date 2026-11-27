// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerContext, PlanningData, PlanningRow } from "@/lib/services/mantencion/looker/types"
import type { MantViewer } from "@/lib/services/mantencion/access"

const data = vi.hoisted(() => ({ load: vi.fn(), search: { current: "pestana=planificacion" } }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(data.search.current),
}))
vi.mock("@/lib/services/mantencion/looker/work-data", () => ({ loadPlanningTabData: data.load }))

import { PlanificacionTab } from "./planificacion-tab"

const VIEWER = { userId: "u-1", email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true } as unknown as MantViewer
const contextOf = (overrides: Record<string, unknown> = {}) => ({
  filters: {
    tab: "planificacion", unit: "km", from: "2026-11-01", to: "2026-11-30", requestedFrom: "2026-11-01", requestedTo: "2026-11-30", invalidPeriod: false,
    worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {}, planningState: null, dateField: "proxima", dateFrom: null, dateTo: null,
    invalidDateRange: false, ...overrides,
  },
  options: { worksites: [], equipment: [], frequencies: [] },
  cross: {},
}) as unknown as LookerContext

function planningRow(overrides: Partial<PlanningRow> = {}): PlanningRow {
  return {
    vehicleId: "v-1", code: "KA-135", plate: "RBYD98", label: "KA-135 · RBYD98", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Cabrero", unit: "km",
    scheduleName: "Camiones y tractos", intervals: [10_000], frequency: 10_000, lastDate: "2026-03-10", programmed: 10_000, real: 10_350, current: 15_000, next: 20_000,
    delta: -350, remaining: 5_000, base: 10_000, state: "al_dia", declared: false, evidence: null, manual: false, manualReason: null, outOfRange: false,
    dailyUsage: 240, estimatedDate: "2026-12-16", estimateNote: null, ...overrides,
  }
}

function planning(rows: PlanningRow[], overrides: Partial<PlanningData> = {}): PlanningData {
  const counts = { total: rows.length, vencida: 0, proxima: 0, al_dia: rows.length, sin_dato: 0 }
  return { rows, counts, selectedId: null, ...overrides }
}

async function renderTab(context = contextOf()) {
  render(await PlanificacionTab({ context, viewer: VIEWER }))
}

beforeEach(() => {
  data.load.mockReset()
  data.search.current = "pestana=planificacion"
})
afterEach(cleanup)

describe("pestaña Planificación · sin período (PAN4-6)", () => {
  it("el vacío de los dos gráficos dice lo que mide, sin hablar de un período que esta pestaña no tiene", async () => {
    data.load.mockResolvedValue(planning([]))
    await renderTab()
    expect(screen.getByText("Ningún equipo tiene pauta y lectura para calcular lo que le falta.")).toBeTruthy()
    expect(screen.getByText("No hay mantenciones con lectura programada y real.")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/en el período/i)
  })

  it("la nota de arriba dice que es el estado de hoy, sin período, con el vocabulario de «tocaba»", async () => {
    data.load.mockResolvedValue(planning([]))
    await renderTab()
    expect(screen.getByText(/^Estado de hoy de cada equipo, sin período/)).toBeTruthy()
    expect(screen.getAllByText(/aunque se haya hecho tarde/).length).toBeGreaterThan(0)
  })

  it("una última mantención lejana se muestra sin la nota de «fuera de rango» al pasar el cursor", async () => {
    data.load.mockResolvedValue(planning([planningRow({ lastDate: "2025-01-15", outOfRange: true })]))
    await renderTab()
    const table = within(screen.getByRole("table", { name: /Detalle por equipo/ }))
    const date = table.getByText("15-01-2025")
    expect(date.getAttribute("title")).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/fuera del rango/)
  })
})

describe("pestaña Planificación · secciones", () => {
  it("responde dos preguntas en un solo panel de gráficos y deja el detalle en su propio panel", async () => {
    data.load.mockResolvedValue(planning([planningRow()]))
    await renderTab()
    expect(screen.getByRole("heading", { level: 2, name: "¿Cuánto le falta a cada equipo?" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Detalle por equipo" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 3, name: "Faltantes para la próxima mantención" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 3, name: "¿Se hizo a tiempo la última mantención?" })).toBeTruthy()
    expect(document.querySelectorAll("[data-dashboard-panel]")).toHaveLength(2)
    expect(screen.getByText(/La marca es el 85 % \(umbral de «próxima»\)/)).toBeTruthy()
  })

  it("la tira de cifras filtra por estado con enlaces que reemplazan y marca la vigente", async () => {
    data.search.current = "pestana=planificacion&estado=vencida"
    data.load.mockResolvedValue(planning([planningRow({ remaining: -2_000 })], { counts: { total: 3, vencida: 1, proxima: 1, al_dia: 1, sin_dato: 0 } }))
    await renderTab()
    const strip = within(document.querySelector("[data-planning-summary]") as HTMLElement)
    const links = strip.getAllByRole("link")
    expect(links).toHaveLength(5)
    const vencidas = strip.getByRole("link", { name: /Vencidas/ })
    expect(vencidas.getAttribute("aria-current")).toBe("true")
    // Segundo clic sobre la vigente: quita el estado.
    expect(vencidas.getAttribute("href")).toBe("/mantencion/panel?pestana=planificacion")
    expect(strip.getByRole("link", { name: /Próximas/ }).getAttribute("href")).toContain("estado=proxima")
    expect(strip.getByRole("link", { name: /Equipos controlados/ }).getAttribute("href")).toBe("/mantencion/panel?pestana=planificacion")
    expect(strip.getByText("por kilómetros")).toBeTruthy()
    expect(strip.getByText("filtrando")).toBeTruthy()
  })
})

describe("pestaña Planificación · faltantes y «¿a tiempo?»", () => {
  it("cada equipo dice cuánto falta o cuánto lleva vencido, con su fecha estimada", async () => {
    data.load.mockResolvedValue(planning([
      planningRow({ vehicleId: "v-1", plate: "AAAA11", code: "KA-1", remaining: -11_801, estimatedDate: "2026-10-09" }),
      planningRow({ vehicleId: "v-2", plate: "BBBB22", code: "KA-2", remaining: 3_144, estimatedDate: "2026-12-16" }),
      planningRow({ vehicleId: "v-3", plate: "CCCC33", code: "KA-3", remaining: 6_000, estimatedDate: null, estimateNote: "El equipo no registra uso en los últimos 30 días" }),
      planningRow({ vehicleId: "v-4", plate: "DDDD44", code: "KA-4", remaining: null, next: null, base: null }),
    ]))
    await renderTab()
    const group = within(screen.getByRole("group", { name: "Faltantes para la próxima mantención por equipo" }))
    expect(group.getAllByRole("button")).toHaveLength(3)
    expect(group.getByText("Vencida por 11.801 km")).toBeTruthy()
    expect(group.getByText("desde ≈ 09-10-2026")).toBeTruthy()
    expect(group.getByText("Faltan 3.144 km")).toBeTruthy()
    expect(group.getByText("≈ 16-12-2026")).toBeTruthy()
    const none = group.getByText("—")
    expect(none.getAttribute("title")).toBe("El equipo no registra uso en los últimos 30 días")
    expect(group.getByRole("button", { name: /AAAA11: Vencida por 11\.801 km/ })).toBeTruthy()
    // El equipo sin pauta no se dibuja y la descripción lo dice.
    expect(screen.getByText(/1 equipo sin pauta o lectura no aparece/)).toBeTruthy()
    expect(group.queryByText(/DDDD44/)).toBeNull()
  })

  it("«¿a tiempo?» usa los textos de tarde, antes y a tiempo", async () => {
    data.load.mockResolvedValue(planning([
      planningRow({ vehicleId: "v-1", plate: "AAAA11", programmed: 400_000, real: 414_394, delta: -14_394, base: 40_000 }),
      planningRow({ vehicleId: "v-2", plate: "BBBB22", programmed: 10_000, real: 9_640, delta: 360, base: 10_000 }),
      planningRow({ vehicleId: "v-3", plate: "CCCC33", programmed: 10_000, real: 10_050, delta: -50, base: 10_000 }),
    ]))
    await renderTab()
    const group = within(screen.getByRole("group", { name: /Diferencia entre cuando tocaba y cuando se hizo/ }))
    expect(group.getByRole("button", { name: "AAAA11: 14.394 km tarde" })).toBeTruthy()
    expect(group.getByRole("button", { name: "BBBB22: 360 km antes" })).toBeTruthy()
    expect(group.getByRole("button", { name: "CCCC33: A tiempo" })).toBeTruthy()
    expect(group.getByRole("button", { name: "AAAA11: 14.394 km tarde" }).getAttribute("title")).toContain("Tocaba a los 400.000 km y se hizo a los 414.394 km")
  })

  it("en horas habla de horas", async () => {
    data.load.mockResolvedValue(planning([planningRow({ unit: "h", remaining: 80, dailyUsage: 8 })]))
    await renderTab(contextOf({ unit: "h" }))
    expect(screen.getByText(/^Cuántas horas de diferencia/)).toBeTruthy()
  })
})

describe("pestaña Planificación · detalle por equipo", () => {
  it("una fila por equipo con la patente que abre el historial y un embudo aparte que filtra", async () => {
    data.load.mockResolvedValue(planning([planningRow()]))
    await renderTab()
    const table = within(screen.getByRole("table", { name: /Detalle por equipo/ }))
    for (const header of ["Equipo", "Última mantención", "Tocaba a los", "Se hizo a los", "¿A tiempo?", "Lectura actual", "Próxima a los", "Faltan", "Fecha estimada", "Estado"]) {
      expect(table.getByRole("columnheader", { name: new RegExp(header.replace("?", "\\?")) })).toBeTruthy()
    }
    const link = table.getByRole("link", { name: "RBYD98" })
    expect(link.getAttribute("href")).toContain("/mantencion/registros/historicos")
    expect(link.getAttribute("href")).toContain("equipo=v-1")
    expect(table.getByRole("button", { name: "Filtrar el panel por RBYD98" })).toBeTruthy()
    expect(table.getByText("Cada 10.000 km")).toBeTruthy()
    expect(table.getByText("≈ 240 km/día")).toBeTruthy()
    expect(table.getByText("≈ 16-12-2026")).toBeTruthy()
    expect(table.getByText("350 km tarde")).toBeTruthy()
    expect(table.getByText("Al día")).toBeTruthy()
    expect(screen.getByText("1 equipo")).toBeTruthy()
  })

  it("un equipo sin estimación muestra «—» con la razón y conserva las marcas de ajuste y declarada", async () => {
    data.load.mockResolvedValue(planning([
      planningRow({ estimatedDate: null, dailyUsage: null, estimateNote: "Sin lecturas suficientes en los últimos 30 días para calcular el uso diario", manual: true, manualReason: "Terreno difícil", declared: true, evidence: "Planilla 2026" }),
    ]))
    await renderTab()
    const table = within(screen.getByRole("table", { name: /Detalle por equipo/ }))
    expect(table.getAllByText("—").some((node) => node.getAttribute("title")?.startsWith("Sin lecturas suficientes"))).toBe(true)
    expect(table.getByText("Ajustada")).toBeTruthy()
    expect(table.getByText("Declarada")).toBeTruthy()
  })

  it("sin equipos dice qué probar; con un estado sin coincidencias, que lo quite", async () => {
    data.load.mockResolvedValue(planning([]))
    await renderTab()
    expect(screen.getAllByText("Sin equipos por kilómetros con estos filtros").length).toBeGreaterThan(0)
    cleanup()
    data.load.mockResolvedValue(planning([], { counts: { total: 4, vencida: 0, proxima: 0, al_dia: 4, sin_dato: 0 } }))
    await renderTab(contextOf({ planningState: "vencida" }))
    expect(screen.getAllByText("Ningún equipo está en estado «Vencidas»").length).toBeGreaterThan(0)
  })
})
