import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

import { exportBoardDataAction, exportChartDataAction } from "./chart-data-export-action"

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

/**
 * «Exportar Excel» de la cabecera de un tablero: las tablas «Ver datos» de la pantalla, una hoja por
 * gráfico. Rige lo mismo que para una tabla sola, y con varias tablas, cada permiso.
 */
describe("exportBoardDataAction", () => {
  const board = {
    title: "Panel de combustible",
    scope: { periodo: "Noviembre 2026", faena: "Biodiversa" },
    range: { from: "2026-11-01", to: "2026-11-15" },
    tables: [
      { ...input, notes: ["Sin datos del proveedor en sep-2026."] },
      { permission: "combustibles:export" as const, title: "Litros por faena en el período", headers: ["Faena", "Litros"], rows: [["Biodiversa", 500]] },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
  })

  it("arma un libro con una hoja por gráfico, en el orden de la pantalla, y el alcance en «Metadatos»", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z"))
    try {
      const result = await exportBoardDataAction(board)

      if (!result.ok || !result.data) throw new Error("la exportación debió resolverse")
      expect(result.data.filename).toBe("panel_de_combustible_2026-11-15.xlsx")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
      const names = workbook.worksheets.map((sheet) => sheet.name)
      expect(names.slice(0, 2)).toEqual(["Litros por mes", "Litros por faena en el período"])
      expect(workbook.getWorksheet("Litros por faena en el período")!.getRow(2).getCell(2).value).toBe(500)
      const metadata = workbook.worksheets.find((sheet) => /metadatos/i.test(sheet.name))!
      const text = JSON.stringify(metadata.getSheetValues())
      expect(text).toContain("Noviembre 2026")
      // Las fechas que mide el período, no «Sin filtro».
      expect(text).not.toContain("Sin filtro")
      expect(text).toContain("Biodiversa")
      // La salvedad de un gráfico viaja con su título, para saber a qué hoja se refiere.
      expect(text).toContain("«Litros por mes»: Sin datos del proveedor en sep-2026.")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "board_data_export",
        newState: expect.objectContaining({ title: "Panel de combustible", permissions: ["combustibles:export"] }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it("exige cada permiso de exportar que declaran sus tablas, y sin uno no arma nada", async () => {
    const mixed = { ...board, tables: [board.tables[0]!, { ...board.tables[1]!, permission: "mant:export" as const }] }
    mockRequirePermission.mockImplementation(async (permission: string) => {
      if (permission === "mant:export") throw new Error("Forbidden")
      return session
    })

    expect(await exportBoardDataAction(mixed)).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockRequirePermission).toHaveBeenCalledWith("combustibles:export")
    expect(mockRequirePermission).toHaveBeenCalledWith("mant:export")
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("rechaza un tablero sin tablas, con un permiso de «ver» o con más hojas que el tope, antes de mirar la sesión", async () => {
    expect((await exportBoardDataAction({ ...board, tables: [] })).ok).toBe(false)
    expect((await exportBoardDataAction({ ...board, tables: [{ ...input, permission: "combustibles:view" as never }] })).ok).toBe(false)
    expect((await exportBoardDataAction({ ...board, tables: Array.from({ length: 25 }, () => input) })).ok).toBe(false)
    expect(mockRequirePermission).not.toHaveBeenCalled()
  })
})
