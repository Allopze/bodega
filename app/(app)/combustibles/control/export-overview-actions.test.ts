import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildCrosstab } from "@/lib/combustibles/control/view-helpers"

const requirePermission = vi.hoisted(() => vi.fn())
const getWorksiteMediumCrosstab = vi.hoisted(() => vi.fn())
const recordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission, can: vi.fn() }))
vi.mock("@/lib/combustibles/control/queries/overview", () => ({
  getWorksiteMediumCrosstab,
  getLitersByMonthAndMedium: vi.fn(),
  getMeterSeries: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({ recordAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

const { exportCrosstabAction } = await import("./export-overview-actions")

const session = { user: { id: "u1", email: "a@b.cl", isGlobal: true, worksiteIds: [], permissions: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  requirePermission.mockResolvedValue(session)
  getWorksiteMediumCrosstab.mockResolvedValue(buildCrosstab([
    { worksiteId: "w1", worksiteName: "Faena 1", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 100 },
    { worksiteId: "w2", worksiteName: "Faena 2", mediumId: null, mediumName: null, mediumOrder: null, liters: 20 },
  ]))
})

describe("exportCrosstabAction", () => {
  it("sin permiso de exportar no consulta", async () => {
    requirePermission.mockRejectedValue(new Error("Forbidden"))
    expect((await exportCrosstabAction({ params: {}, unit: "km_per_liter" })).ok).toBe(false)
    expect(getWorksiteMediumCrosstab).not.toHaveBeenCalled()
  })

  it("reconstruye con los filtros de la URL y la unidad pedida, y lleva fila de totales", async () => {
    const result = await exportCrosstabAction({ params: { anio: "2026", meses: "3,4" }, unit: "liters_per_hour" })
    expect(getWorksiteMediumCrosstab.mock.calls[0]![1]).toMatchObject({ year: 2026, months: [3, 4] })
    expect(getWorksiteMediumCrosstab.mock.calls[0]![2]).toBe("liters_per_hour")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from((result as { data: { base64: string } }).data.base64, "base64") as unknown as Parameters<typeof wb.xlsx.load>[0])
    const ws = wb.worksheets[0]!
    expect(ws.getRow(1).values).toEqual([undefined, "Faena", "TCT (L)", "Sin medio informado (L)", "Total (L)"])
    const totals = ws.getRow(ws.rowCount).values as unknown[]
    expect(totals[1]).toBe("Total")
    expect(totals[4]).toBe(120)
    expect(ws.getRow(ws.rowCount).font?.bold).toBe(true)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "fuel_control_overview_export" }))
  })

  it("una unidad inválida cae a km/L, nunca a un valor sin validar", async () => {
    await exportCrosstabAction({ params: {}, unit: "otra" as never })
    expect(getWorksiteMediumCrosstab.mock.calls[0]![2]).toBe("km_per_liter")
  })
})
