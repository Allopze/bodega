// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerContext, PlanningData, PlanningRow } from "@/lib/services/mantencion/looker/types"
import type { MantViewer } from "@/lib/services/mantencion/access"

const data = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("pestana=planificacion"),
}))
vi.mock("@/lib/services/mantencion/looker/work-data", () => ({ loadPlanningTabData: data.load }))

import { PlanificacionTab } from "./planificacion-tab"

const VIEWER = { userId: "u-1", email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true } as unknown as MantViewer
const CONTEXT = {
  filters: { tab: "planificacion", from: "2026-11-01", to: "2026-11-30", requestedFrom: "2026-11-01", requestedTo: "2026-11-30", invalidPeriod: false, worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {} },
  options: { worksites: [], equipment: [], frequencies: [] },
  cross: {},
} as unknown as LookerContext

function planningRow(overrides: Partial<PlanningRow> = {}): PlanningRow {
  return {
    vehicleId: "v-1", code: "KA-135", plate: "RBYD98", label: "KA-135 · RBYD98", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Cabrero", unit: "km",
    scheduleName: "Camiones y tractos", intervals: [10_000], frequency: 10_000, lastDate: "2026-03-10", programmed: 10_000, real: 10_350, current: 15_000, next: 20_000,
    delta: -350, remaining: 5_000, base: 10_000, state: "al_dia", declared: false, evidence: null, manual: false, manualReason: null, outOfRange: false, ...overrides,
  }
}
const planning = (km: PlanningRow[], hours: PlanningRow[]): { kmData: PlanningData; hoursData: PlanningData } => ({
  kmData: { km, hours: [], selectedId: null },
  hoursData: { km: [], hours, selectedId: null },
})

async function renderTab() {
  render(await PlanificacionTab({ context: CONTEXT, viewer: VIEWER }))
}

beforeEach(() => data.load.mockReset())
afterEach(cleanup)

describe("pestaña Planificación · sin período (PAN4-6)", () => {
  it("el vacío de los dos gráficos dice lo que mide, sin hablar de un período que esta pestaña no tiene", async () => {
    data.load.mockResolvedValue(planning([], []))
    await renderTab()
    expect(screen.getAllByText("No hay mantenciones con lectura programada y real.")).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/en el período/i)
  })

  it("la nota de arriba dice que es el estado de hoy, sin período", async () => {
    data.load.mockResolvedValue(planning([], []))
    await renderTab()
    expect(screen.getByText(/^Estado de hoy de cada equipo, sin período/)).toBeTruthy()
  })

  it("una última mantención lejana se muestra sin la nota de «fuera de rango» al pasar el cursor", async () => {
    data.load.mockResolvedValue(planning([planningRow({ lastDate: "2025-01-15", outOfRange: true })], []))
    await renderTab()
    const table = within(screen.getByRole("table", { name: "Consolidado mantención por kilómetros" }))
    const date = table.getByText("15-01-2025")
    expect(date.getAttribute("title")).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/fuera del rango/)
    // Con equipos con delta, los gráficos dibujan barras y no el vacío.
    expect(screen.getByRole("group", { name: "Delta de kilometraje por equipo" })).toBeTruthy()
    expect(screen.getAllByText("No hay mantenciones con lectura programada y real.")).toHaveLength(1)
  })
})
