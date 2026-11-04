import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

import { exportChartDataAction } from "./chart-data-export-action"

const session = { user: { id: "u1", email: "gerencia@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["combustibles:export"] } }
const input = { permission: "combustibles:export" as const, title: "Litros por mes", headers: ["Mes", "Litros"], rows: [["Agosto 2026", 1000], ["Septiembre 2026", null]] }

/**
 * «Ver datos» → Excel. La acción recibe la tabla que el navegador ya muestra: lo que decide si se
 * descarga es el permiso de exportar del módulo, no la sesión sola.
 */
describe("exportChartDataAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
  })

  it("exige el permiso de exportar que declara el gráfico", async () => {
    await exportChartDataAction({ ...input, permission: "analytics:export" })

    expect(mockRequirePermission).toHaveBeenCalledWith("analytics:export")
  })

  it("sin ese permiso responde «Sin permisos» y no arma ni audita nada", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden: missing permission combustibles:export"))

    expect(await exportChartDataAction(input)).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("rechaza un permiso inventado o de «ver» antes de consultar la sesión", async () => {
    const result = await exportChartDataAction({ ...input, permission: "combustibles:view" as never })

    expect(result.ok).toBe(false)
    expect(mockRequirePermission).not.toHaveBeenCalled()
  })

  it("rechaza una tabla fuera de los topes de tamaño", async () => {
    const result = await exportChartDataAction({ ...input, rows: Array.from({ length: 2001 }, () => ["x", 1]) })

    expect(result.ok).toBe(false)
    expect(mockRequirePermission).not.toHaveBeenCalled()
  })

  it("devuelve un .xlsx con las filas de la tabla, nombre derivado del título y del día, y lo deja en la bitácora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-03T15:00:00.000Z"))
    try {
      const result = await exportChartDataAction(input)

      if (!result.ok || !result.data) throw new Error("la exportación debió resolverse")
      expect(result.data.filename).toBe("litros_por_mes_2026-11-03.xlsx")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
      const sheet = workbook.worksheets[0]!
      expect(sheet.getRow(2).getCell(2).value).toBe(1000)
      expect(sheet.getRow(3).getCell(2).value).toBe("")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        userId: "u1",
        action: "export",
        entityType: "chart_data_export",
        newState: { title: "Litros por mes", rowCount: 2, permission: "combustibles:export" },
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it("si armar el libro falla, lo dice sin exponer el error", async () => {
    mockRecordAudit.mockRejectedValueOnce(new Error("conexión a postgres://usuario:clave@host"))

    const result = await exportChartDataAction(input)

    expect(result).toEqual({ ok: false, message: "No se pudo exportar la tabla. Intenta nuevamente." })
  })
})
