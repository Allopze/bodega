import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerContext, PlanningData } from "./types"

const summary = vi.hoisted(() => vi.fn())
const compliance = vi.hoisted(() => vi.fn())
const matrix = vi.hoisted(() => vi.fn())
const planning = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("./corrective", () => ({ loadCorrectiveSummary: summary }))
vi.mock("./preventive", () => ({ loadPreventiveCompliance: compliance, loadChecklistMatrix: matrix }))
vi.mock("./planning", () => ({ loadPlanningData: planning }))

import { loadPlanningTabData, loadWorkControlData } from "./work-data"

const viewer = { userId: "u1", email: null, permissions: [], worksiteIds: [], isGlobal: true }
const context: LookerContext = {
  filters: { tab: "camiones", from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false, worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {} },
  options: { worksites: [], equipment: [], frequencies: [] },
  cross: {},
}

/**
 * Qué consulta cada pestaña y con qué dimensiones ignoradas. La pantalla y «Exportar Excel» comparten estos
 * cargadores: si alguien cambia a qué bloque se le ignora qué filtro, la pantalla y el libro cambian juntos, y
 * esta prueba es la que lo hace visible.
 */
describe("cargadores compartidos de las pestañas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    summary.mockResolvedValue({ drivers: [], series: [], selectedDriver: null })
    compliance.mockResolvedValue({ checks: [], byMonth: [], byWorksiteMechanic: [], byPlate: [], average: null, total: 0 })
    matrix.mockResolvedValue({ checks: [], items: [], withoutDetail: 0 })
    planning.mockResolvedValue({ km: [], hours: [], selectedId: null } satisfies PlanningData)
  })

  it("Planificación: la tabla de km ignora el equipo que ella emite; la de horas lo aplica", async () => {
    await loadPlanningTabData(viewer, context)
    expect(planning).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["equipment"])
    expect(planning).toHaveBeenCalledWith(viewer, context.filters, context.cross)
    expect(planning).toHaveBeenCalledTimes(2)
  })

  it("Camiones y Máquinas: cada bloque ignora la dimensión que él mismo emite", async () => {
    await loadWorkControlData(viewer, context, async () => "filas")
    const ignores = compliance.mock.calls.map((call) => call[3])
    expect(ignores).toEqual([["month"], ["worksite", "mechanic"], ["equipment"]])
    expect(matrix).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["check"], undefined)
    // Conductores: no se filtra por el conductor elegido. Gráfico de equipos: ignora el equipo y sí aplica el conductor.
    expect(summary).toHaveBeenCalledWith(viewer, context.filters, context.cross, { ignore: ["conductor"], applyConductor: false })
    expect(summary).toHaveBeenCalledWith(viewer, context.filters, context.cross, { ignore: ["equipment"], applyConductor: true, conductorWorkIds: undefined })
  })

  it("el conductor elegido acota la tabla de trabajos y el gráfico con los mismos trabajos, y la tabla se pide en paralelo", async () => {
    summary.mockResolvedValueOnce({ drivers: [], series: [], selectedDriver: { key: "juan", label: "JUAN", records: 1, hours: 1, workIds: ["h:1", "ot:2"] } })
    const loadRows = vi.fn(async (ids: string[] | undefined) => ({ ids }))
    const data = await loadWorkControlData(viewer, context, loadRows)
    expect(loadRows).toHaveBeenCalledWith(["h:1", "ot:2"])
    expect(data.rows).toEqual({ ids: ["h:1", "ot:2"] })
    expect(summary).toHaveBeenLastCalledWith(viewer, context.filters, context.cross, { ignore: ["equipment"], applyConductor: true, conductorWorkIds: ["h:1", "ot:2"] })
  })

  it("las opciones de la exportación amplían la matriz y la serie; la pantalla no las pasa", async () => {
    await loadWorkControlData(viewer, context, async () => null, { matrixLimit: 60, seriesLimit: Number.POSITIVE_INFINITY })
    expect(matrix).toHaveBeenCalledWith(viewer, context.filters, context.cross, ["check"], 60)
    expect(summary).toHaveBeenLastCalledWith(viewer, context.filters, context.cross, expect.objectContaining({ seriesLimit: Number.POSITIVE_INFINITY }))
  })
})
