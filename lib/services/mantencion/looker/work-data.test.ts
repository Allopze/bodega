import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerContext } from "./types"

const compliance = vi.hoisted(() => vi.fn())
const matrix = vi.hoisted(() => vi.fn())
const planning = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("./corrective-tab-data", () => ({ loadCorrectiveTabData: vi.fn() }))
vi.mock("./preventive", () => ({ loadPreventiveCompliance: compliance, loadChecklistMatrix: matrix }))
vi.mock("./planning", () => ({ loadPlanningData: planning }))

import { loadPlanningTabData, loadPreventiveTabData } from "./work-data"

const viewer = { userId: "u1", email: null, permissions: [], worksiteIds: [], isGlobal: true }
const context: LookerContext = {
  filters: {
    tab: "preventivo", unit: "km", from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false,
    worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {},
    planningState: null, dateField: "proxima", dateFrom: null, dateTo: null, invalidDateRange: false, sheetVehicleId: null, sheetCheckId: null,
  },
  options: { worksites: [], equipment: [], frequencies: [] },
  cross: {},
}

/**
 * Qué consulta cada pestaña y con qué dimensiones ignoradas. La pantalla y «Exportar Excel» comparten estos
 * cargadores: si alguien cambia a qué bloque se le ignora qué filtro, la pantalla y el libro cambian juntos, y
 * esta prueba es la que lo hace visible. (Correctivo tiene su propia prueba en `corrective-tab-data`.)
 */
describe("cargadores compartidos de las pestañas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    compliance.mockResolvedValue({ checks: [], byMonth: [], byWorksiteMechanic: [], byPlate: [], average: null, total: 0 })
    matrix.mockResolvedValue({ checks: [], items: [], withoutDetail: 0 })
    planning.mockResolvedValue({ rows: [], counts: { vencida: 0, proxima: 0, al_dia: 0, sin_dato: 0, total: 0 }, selectedId: null })
  })

  it("Planificación: una sola consulta de la unidad, que ignora el equipo que ella misma emite (queda completa y se resalta)", async () => {
    await loadPlanningTabData(viewer, context)
    expect(planning).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["equipment"])
    expect(planning).toHaveBeenCalledTimes(1)
  })

  it("Preventivo: la tira usa todos los filtros y cada bloque ignora la dimensión que él mismo emite", async () => {
    await loadPreventiveTabData(viewer, context)
    const ignores = compliance.mock.calls.map((call) => call[3])
    expect(ignores).toEqual([undefined, ["month"], ["worksite", "mechanic"], ["equipment"]])
    expect(matrix).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["check"], undefined)
  })

  it("la exportación amplía la matriz; la pantalla no lo pide", async () => {
    await loadPreventiveTabData(viewer, context, { matrixLimit: 60 })
    expect(matrix).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["check"], 60)
  })
})
