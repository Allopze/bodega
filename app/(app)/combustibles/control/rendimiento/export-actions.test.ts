import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePermission = vi.hoisted(() => vi.fn())
const can = vi.hoisted(() => vi.fn())
const getLoadDetail = vi.hoisted(() => vi.fn())
const getWorksiteStats = vi.hoisted(() => vi.fn())
const recordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission, can }))
vi.mock("@/lib/combustibles/control/queries/performance", () => ({
  EXPORT_ROW_LIMIT: 10_000,
  getWorksiteStats,
  getEquipmentStats: vi.fn(),
}))
vi.mock("@/lib/combustibles/control/queries/performance-detail", () => ({ getLoadDetail }))
vi.mock("@/lib/audit", () => ({ recordAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

const { exportLoadDetailAction, exportWorksiteStatsAction } = await import("./export-actions")

const session = { user: { id: "u1", email: "a@b.cl", isGlobal: true, worksiteIds: [], permissions: [] } }
const detailRow = {
  id: "l1", occurredAt: "2026-03-10T15:00:00Z", worksiteName: "Faena A", code: "KA-01", plate: "AB1234", meterType: "odometer", meterReading: 100,
  unit: "km_per_liter", performanceValue: 3, performanceStatus: "computed", declaredPerformance: 9, liters: 10, supervisor: "Ana Pérez",
  reviewStatus: "ok", source: "field", mediumName: null,
}

async function headersOf(base64: string, sheet: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as Parameters<typeof wb.xlsx.load>[0])
  const ws = wb.getWorksheet(sheet)!
  return { headers: (ws.getRow(1).values as unknown[]).slice(1) as string[], ws, wb }
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePermission.mockResolvedValue(session)
  can.mockReturnValue(false)
  getLoadDetail.mockResolvedValue({ rows: [detailRow], pagination: { totalItems: 1 } })
})

describe("exportaciones de rendimiento", () => {
  it("sin permiso de exportar no consulta ni audita", async () => {
    requirePermission.mockRejectedValue(new Error("Forbidden"))
    const result = await exportLoadDetailAction({ familia: "camiones", params: {} })
    expect(result.ok).toBe(false)
    expect(getLoadDetail).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("una familia desconocida se rechaza", async () => {
    expect((await exportLoadDetailAction({ familia: "grúas", params: {} })).ok).toBe(false)
    expect(getLoadDetail).not.toHaveBeenCalled()
  })

  it("la familia sale del segmento de la URL aunque los parámetros traigan otra", async () => {
    await exportLoadDetailAction({ familia: "camiones", params: { familia: "maquinaria" } })
    expect(getLoadDetail.mock.calls[0]![1]).toMatchObject({ family: "camiones" })
  })

  it("sin datos personales no hay columna de supervisor ni se pide el nombre", async () => {
    const result = await exportLoadDetailAction({ familia: "camiones", params: { anio: "2026" } })
    expect(result.ok).toBe(true)
    expect(getLoadDetail.mock.calls[0]![2]).toMatchObject({ includePersonal: false, all: true })
    const { headers } = await headersOf((result as { data: { base64: string } }).data.base64, "Detalle de cargas")
    expect(headers).not.toContain("Supervisor")
    expect(headers).toContain("Declarado en planilla")
  })

  it("con datos personales agrega la columna y lo deja asentado en la auditoría", async () => {
    can.mockImplementation((_session: unknown, permission: string) => permission === "combustibles:view_personal")
    const result = await exportLoadDetailAction({ familia: "camiones", params: {} })
    const { headers, ws } = await headersOf((result as { data: { base64: string } }).data.base64, "Detalle de cargas")
    expect(headers).toContain("Supervisor")
    expect(ws.getRow(2).values).toContain("Ana Pérez")
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "fuel_control_performance_export", newState: expect.objectContaining({ includesPersonal: true }) }))
  })

  it("lleva la hoja de metadatos con los filtros aplicados", async () => {
    getWorksiteStats.mockResolvedValue([{ worksiteId: "w", worksiteName: "Faena A", unit: "km_per_liter", n: 3, mean: 4, sd: null, cv: null }])
    const result = await exportWorksiteStatsAction({ familia: "camiones", params: { anio: "2026", meses: "3", unidad: "km_per_liter" } })
    const { wb, headers } = await headersOf((result as { data: { base64: string } }).data.base64, "Rendimiento por faena")
    expect(headers).toContain("Desviación estándar muestral")
    const meta = wb.getWorksheet("Metadatos")!
    const text = JSON.stringify(meta.getSheetValues())
    expect(text).toContain("km/L")
    expect(text).toContain("Camiones y tracto camiones")
  })
})
