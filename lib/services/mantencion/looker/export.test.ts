import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChecklistMatrix, CorrectiveWorkRow, LookerContext, PlanningRow } from "./types"

const loadContext = vi.hoisted(() => vi.fn())
const loadPlanning = vi.hoisted(() => vi.fn())
const loadWork = vi.hoisted(() => vi.fn())
const loadRows = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("./resolve", () => ({ loadLookerContext: loadContext }))
vi.mock("./work-data", () => ({ loadPlanningTabData: loadPlanning, loadWorkControlData: loadWork }))
vi.mock("./corrective", () => ({ loadCorrectiveRows: loadRows }))

import { buildLookerExport, LOOKER_EXPORT_MATRIX_CHECKS } from "./export"

const session = { user: { id: "u1", email: "jefe@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["mant:export", "mant:records:view_all"] } } as unknown as Session

const context = (tab: "planificacion" | "camiones" | "maquinas"): LookerContext => ({
  filters: {
    tab, from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false,
    worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {},
  },
  options: { worksites: [{ id: "ws-1", name: "Teno" }], equipment: [], frequencies: [] },
  cross: {},
})

const plan = (over: Partial<PlanningRow> = {}): PlanningRow => ({
  vehicleId: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Teno", unit: "km",
  scheduleName: "Camiones", intervals: [40_000], frequency: 40_000, lastDate: "2026-10-15", programmed: 340_000, real: 339_990, current: 345_000,
  next: 350_000, delta: 10, remaining: 5_000, base: 10_000, state: "al_dia", declared: false, evidence: null, manual: false, manualReason: null,
  outOfRange: false, ...over,
})

const work = (n: number): CorrectiveWorkRow => ({
  id: `h:${n}`, source: "historial", date: "2026-10-15", vehicleId: "v-1", recordId: null, code: "KA-143", plate: "SJFC-66", typeName: "Camión", unit: "km",
  reading: null, readingText: "145.000", reference: `F-${n}`, workPerformed: `Trabajo ${n}`, worksiteId: "ws-1", worksiteName: "Teno", hours: 1,
  photoId: null, photoUrl: null,
})

const emptyMatrix: ChecklistMatrix = { checks: [], items: [], withoutDetail: 0 }
const compliance = { checks: [], byMonth: [], byWorksiteMechanic: [], byPlate: [], average: null, total: 0 }

async function load(base64: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer)
  return workbook
}

beforeEach(() => {
  vi.clearAllMocks()
  loadContext.mockImplementation(async (_viewer: unknown, raw: Record<string, string>) => context(raw.pestana as "camiones"))
  loadPlanning.mockResolvedValue({
    kmData: { km: [plan(), plan({ vehicleId: "v-2", code: "KA-144", plate: "ABCD-12" })], hours: [], selectedId: null },
    hoursData: { km: [], hours: [plan({ unit: "h", code: "TO-37", plate: "TO-37" })], selectedId: null },
  })
  loadRows.mockResolvedValue({ rows: [work(1), work(2), work(3)], total: 3 })
  loadWork.mockImplementation(async (_viewer: unknown, _context: unknown, rows: (ids: string[] | undefined) => Promise<unknown>) => ({
    drivers: { drivers: [{ key: "juan", label: "JUAN", records: 1, hours: 1, workIds: ["h:1"] }], series: [], selectedDriver: null },
    monthly: { ...compliance, byMonth: [{ key: "2026-10", label: "oct 2026", percent: 90, checks: 1 }] },
    byWorksite: compliance,
    byPlate: compliance,
    matrix: emptyMatrix,
    chart: { drivers: [], series: [{ vehicleId: "v-1", label: "KA-143", records: 3, hours: 3 }], selectedDriver: null },
    rows: await rows(undefined),
  }))
})

describe("buildLookerExport · Planificación", () => {
  it("el libro trae las dos tablas del consolidado, «Filtros» y «Metadatos», con las mismas filas que la pantalla", async () => {
    const result = await buildLookerExport(session, { tab: "planificacion", params: { desde: "2026-10-01" }, today: "2026-11-24" })
    expect(loadContext).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), { desde: "2026-10-01", pestana: "planificacion" }, "2026-11-24")
    const workbook = await load(result.base64)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Consolidado por kilómetros", "Consolidado por horas", "Filtros", "Metadatos"])
    expect(workbook.getWorksheet("Consolidado por kilómetros")!.rowCount).toBe(3)
    expect(workbook.getWorksheet("Consolidado por horas")!.getRow(2).getCell(2).value).toBe("TO-37")
    expect(result.title).toBe("Panel de mantención · Planificación")
    expect(result.sheets).toEqual([
      { title: "Consolidado por kilómetros", rowCount: 2 },
      { title: "Consolidado por horas", rowCount: 1 },
    ])
    expect(result.truncated).toBe(false)
  })

  it("«Metadatos» lleva el período y los filtros aplicados", async () => {
    const result = await buildLookerExport(session, { tab: "planificacion", params: {}, today: "2026-11-24" })
    const metadata = (await load(result.base64)).getWorksheet("Metadatos")!
    const rows = new Map(metadata.getSheetValues().slice(1).map((row) => [(row as unknown[])[1], (row as unknown[])[2]]))
    expect(rows.get("Período (desde)")).toBe("2026-10-01")
    expect(rows.get("Período (hasta)")).toBe("2026-10-31")
    expect(String(rows.get("Filtros aplicados"))).toContain("Planificación")
  })
})

describe("buildLookerExport · Camiones y Máquinas", () => {
  it("trae las diez hojas en el orden de la pantalla y pide la unidad de la pestaña", async () => {
    const result = await buildLookerExport(session, { tab: "camiones", params: {}, today: "2026-11-24" })
    const workbook = await load(result.base64)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Correctivos", "Conductores", "Horas y registros", "Cumplimiento por mes", "Cumplimiento faena y mecánico", "Cumplimiento por patente",
      "Matriz de checklist", "Pautas de la matriz", "Filtros", "Metadatos",
    ])
    expect(workbook.getWorksheet("Correctivos")!.getRow(1).getCell(8).value).toBe("Odómetro (km)")
    expect(workbook.getWorksheet("Correctivos")!.rowCount).toBe(4)
    const hours = await buildLookerExport(session, { tab: "maquinas", params: {}, today: "2026-11-24" })
    expect((await load(hours.base64)).getWorksheet("Correctivos")!.getRow(1).getCell(8).value).toBe("Horómetro (h)")
  })

  it("pide TODAS las filas del filtro (sin página), la matriz ampliada y la serie completa; el conductor elegido acota las filas", async () => {
    await buildLookerExport(session, { tab: "camiones", params: {}, today: "2026-11-24" })
    expect(loadWork).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Function), { matrixLimit: LOOKER_EXPORT_MATRIX_CHECKS, seriesLimit: Number.POSITIVE_INFINITY })
    expect(LOOKER_EXPORT_MATRIX_CHECKS).toBeGreaterThan(8)
    expect(loadRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tab: "camiones" }), expect.anything(), { conductorWorkIds: undefined, limit: 20_000 })
  })

  it("sobre el tope de filas corta la hoja, lo dice en «Filtros» y lo marca en el resultado", async () => {
    loadRows.mockResolvedValue({ rows: [work(1), work(2)], total: 5 })
    const result = await buildLookerExport(session, { tab: "camiones", params: {}, today: "2026-11-24", maxRows: 2 })
    expect(loadRows).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ limit: 2 }))
    expect(result.truncated).toBe(true)
    expect(result.sheets[0]).toEqual({ title: "Correctivos", rowCount: 2 })
    const filters = (await load(result.base64)).getWorksheet("Filtros")!
    const notes = filters.getSheetValues().slice(1).map((row) => String((row as unknown[])[2]))
    expect(notes.some((note) => /«Correctivos»: la hoja se cortó en 2 de 5 trabajos; acota el período/.test(note))).toBe(true)
  })

  it("una hoja de cumplimiento o de conductores que pasa del tope también se corta con aviso", async () => {
    loadWork.mockResolvedValueOnce({
      drivers: { drivers: [1, 2, 3].map((n) => ({ key: `c${n}`, label: `C${n}`, records: 1, hours: 1, workIds: [] })), series: [], selectedDriver: null },
      monthly: compliance, byWorksite: compliance, byPlate: compliance, matrix: emptyMatrix,
      chart: { drivers: [], series: [], selectedDriver: null }, rows: { rows: [], total: 0 },
    })
    const result = await buildLookerExport(session, { tab: "camiones", params: {}, today: "2026-11-24", maxRows: 2 })
    expect(result.sheets.find((sheet) => sheet.title === "Conductores")).toEqual({ title: "Conductores", rowCount: 2 })
    expect(result.truncated).toBe(true)
  })
})
