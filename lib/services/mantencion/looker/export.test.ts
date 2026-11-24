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

/**
 * Los textos libres del histórico (observación, mecánico, conductor, trabajo realizado, ítems, código y patente) y los de la URL
 * (conductor, mecánico) llegan a un libro que Excel abre. Un valor que parte con `=`, `+`, `-` o `@` se escribe como texto con un
 * apóstrofo delante, nunca como fórmula. Se arma el libro real con valores hostiles en cada hoja nueva y se relee cada celda.
 */
describe("buildLookerExport · neutralización de fórmulas", () => {
  const [EQ, AT, PLUS, MINUS] = ["=1+1", "@SUM(1)", "+1", "-1"] as const

  async function hostileWorkbook() {
    const hostileCheck = {
      id: "h:p1", source: "historial" as const, date: "2026-10-15", label: EQ, code: EQ, plate: AT, worksiteName: MINUS, level: PLUS,
      mechanic: PLUS, photoIds: [], photoUrls: [], observations: MINUS,
      items: { [AT]: "realizado" as const, [EQ]: "no_realizado" as const }, itemOrder: { [AT]: 0, [EQ]: 1 }, itemGroups: { [AT]: MINUS, [EQ]: PLUS },
    }
    loadContext.mockImplementationOnce(async () => ({
      ...context("camiones"),
      cross: {
        conductor: { key: "x", label: EQ },
        mechanic: { key: "y", label: AT },
        equipment: { id: "v-1", code: PLUS, plate: MINUS, label: EQ, worksiteId: "ws-1", worksiteName: AT, unit: "km", intervals: [], frequency: null },
      },
    }))
    loadWork.mockResolvedValueOnce({
      drivers: { drivers: [{ key: "a", label: EQ, records: 1, hours: 1, workIds: [] }], series: [], selectedDriver: null },
      monthly: compliance,
      byWorksite: { ...compliance, byWorksiteMechanic: [{ key: "k", label: "x", percent: 90, checks: 1, worksiteName: AT, mechanicLabel: PLUS }] },
      byPlate: { ...compliance, byPlate: [{ vehicleId: "v-1", code: PLUS, plate: MINUS, worksiteId: null, worksiteName: EQ, percent: 90, checks: 1, levels: [AT] }] },
      matrix: { checks: [hostileCheck], items: [{ name: AT, group: MINUS, sortOrder: 0 }, { name: EQ, group: PLUS, sortOrder: 1 }], withoutDetail: 0 },
      chart: { drivers: [], series: [{ vehicleId: "v-1", label: PLUS, records: 1, hours: 1 }], selectedDriver: null },
      rows: { rows: [{ ...work(1), reference: AT, code: PLUS, plate: MINUS, typeName: EQ, worksiteName: PLUS, readingText: MINUS, workPerformed: EQ }], total: 1 },
    })
    const result = await buildLookerExport(session, { tab: "camiones", params: {}, today: "2026-11-24" })
    return load(result.base64)
  }

  it("ninguna celda de ninguna hoja es una fórmula ni parte con =, +, - o @: quedan como texto con apóstrofo", async () => {
    const workbook = await hostileWorkbook()
    const strings: string[] = []
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        expect(cell.type, `${sheet.name}!${cell.address}`).not.toBe(ExcelJS.ValueType.Formula)
        expect(cell.formula, `${sheet.name}!${cell.address}`).toBeUndefined()
        if (typeof cell.value === "string") {
          expect(cell.value, `${sheet.name}!${cell.address}`).not.toMatch(/^[=+\-@]/)
          strings.push(cell.value)
        }
      }))
    }
    // Y los valores hostiles sí llegaron al libro, como texto.
    for (const text of [`'${EQ}`, `'${AT}`, `'${PLUS}`, `'${MINUS}`]) expect(strings, text).toContain(text)
  })

  it("las celdas concretas: trabajo realizado, conductor, mecánico, observación, ítem y encabezado de la matriz", async () => {
    const workbook = await hostileWorkbook()
    const cell = (sheet: string, address: string) => workbook.getWorksheet(sheet)!.getCell(address).value
    expect(cell("Correctivos", "K2")).toBe(`'${EQ}`)
    expect(cell("Conductores", "A2")).toBe(`'${EQ}`)
    expect(cell("Cumplimiento faena y mecánico", "B2")).toBe(`'${PLUS}`)
    expect(cell("Pautas de la matriz", "F2")).toBe(`'${PLUS}`)
    expect(cell("Pautas de la matriz", "I2")).toBe(`'${MINUS}`)
    expect(cell("Matriz de checklist", "A2")).toBe(`'${AT}`)
    expect(cell("Matriz de checklist", "C1")).toBe(`'${EQ} · 15-10-2026 · ${PLUS}`)
    // Lo que viene de la URL (conductor y mecánico elegidos) también va saneado en «Filtros».
    const filters = workbook.getWorksheet("Filtros")!
    const rows = filters.getSheetValues().slice(1).map((row) => [(row as unknown[])[1], (row as unknown[])[2]])
    expect(rows).toContainEqual(["Filtro cruzado: Conductor", `'${EQ}`])
    expect(rows).toContainEqual(["Filtro cruzado: Mecánico", `'${AT}`])
  })

  it("Planificación: pauta, faena y observación de un equipo con texto hostil también quedan como texto", async () => {
    loadPlanning.mockResolvedValueOnce({
      kmData: { km: [plan({ scheduleName: EQ, worksiteName: AT, plate: PLUS, code: MINUS, manual: true, manualReason: EQ, declared: true, evidence: AT })], hours: [], selectedId: null },
      hoursData: { km: [], hours: [], selectedId: null },
    })
    const result = await buildLookerExport(session, { tab: "planificacion", params: {}, today: "2026-11-24" })
    const sheet = (await load(result.base64)).getWorksheet("Consolidado por kilómetros")!
    const values = (sheet.getRow(2).values as unknown[]).slice(1)
    expect(values).toEqual(expect.arrayContaining([`'${PLUS}`, `'${MINUS}`, `'${AT}`, `'${EQ}`]))
    for (const value of values) if (typeof value === "string") expect(value).not.toMatch(/^[=+\-@]/)
    expect(String(sheet.getRow(2).getCell(15).value)).toBe("Intervalo ajustado a mano: =1+1; Preventiva declarada (respaldo: @SUM(1))")
  })
})
