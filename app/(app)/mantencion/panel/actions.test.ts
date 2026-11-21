import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MaintenanceWorkRow } from "@/lib/services/mantencion/maintenance-work"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn(async () => undefined))
const loadWork = vi.hoisted(() => vi.fn())
const resolveEquipment = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/mantencion/access", () => ({ viewerFromSession: () => ({ userId: "u1" }) }))
vi.mock("@/lib/services/mantencion/maintenance-work", () => ({ loadMaintenanceWork: loadWork, resolvePanelEquipment: resolveEquipment }))

import { workSheetRow } from "@/lib/services/mantencion/maintenance-work-sheet"
import { exportPanelBoardAction } from "./actions"

const session = { user: { id: "u1", email: "jefe@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["mant:export"] } }
const row = (over: Partial<MaintenanceWorkRow> = {}): MaintenanceWorkRow => ({
  id: "h:1", source: "historial", reference: "MT-00001", date: "2026-10-05", vehicleId: "v-1", equipmentLabel: "KA-1 · AAAA-01",
  worksiteId: "ws-1", worksiteName: "Biodiversa", actionType: "correctiva", laborHours: 6, workshopDays: 4, inWorkshop: false, external: true, ...over,
})
const board = {
  title: "Panel de mantención",
  scope: { periodo: "Octubre 2026", faena: "Biodiversa" },
  range: { from: "2026-10-01", to: "2026-10-31" },
  filters: { from: "2026-10-01", to: "2026-10-31", faena: "ws-1", equipo: null },
  tables: [{ permission: "mant:export" as const, title: "Estado de las pautas hoy", headers: ["Estado", "Equipos"], rows: [["Sin pauta definida", 3]] }],
}

describe("hoja «Trabajos» del Excel del Panel", () => {
  it("una fila por trabajo; lo que el trabajo no trae queda vacío, nunca en cero", () => {
    expect(workSheetRow(row())).toEqual(["05-10-2026", "KA-1 · AAAA-01", "Biodiversa", "Correctiva", 6, 4, "Sí", "Historial de formularios", "MT-00001"])
    expect(workSheetRow(row({ laborHours: null, workshopDays: null, external: null, worksiteName: null, reference: "", actionType: "sin_clasificar", source: "ot" })))
      .toEqual(["05-10-2026", "KA-1 · AAAA-01", "Sin faena", "Sin clasificar", null, null, "No informado", "Orden de trabajo", null])
    expect(workSheetRow(row({ workshopDays: 9, inWorkshop: true }))[5]).toBe("9 (en taller)")
  })
})

describe("exportPanelBoardAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    resolveEquipment.mockResolvedValue(null)
    loadWork.mockResolvedValue({ rows: [row(), row({ id: "ot:2", source: "ot", reference: "OT-2", actionType: "preventiva", laborHours: null })], includesOrders: true })
  })

  it("exige `mant:export` aunque las tablas no lo declaren, y sin él no consulta ni audita", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden"))
    expect(await exportPanelBoardAction(board)).toEqual({ ok: false, message: "Sin permisos" })
    expect(loadWork).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("agrega la hoja «Trabajos» después de las del tablero, con el período y la faena pedidos, y deja la auditoría", async () => {
    const result = await exportPanelBoardAction(board)
    if (!result.ok || !result.data) throw new Error("la exportación debió resolverse")
    expect(loadWork).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ from: "2026-10-01", to: "2026-10-31", worksiteId: "ws-1" }))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((sheet) => sheet.name).slice(0, 2)).toEqual(["Estado de las pautas hoy", "Trabajos"])
    const sheet = workbook.getWorksheet("Trabajos")!
    expect(sheet.getRow(1).getCell(1).value).toBe("Fecha")
    expect(sheet.getRow(2).getCell(2).value).toBe("KA-1 · AAAA-01")
    expect(sheet.getRow(2).getCell(5).value).toBe(6)
    // La hora hombre que el trabajo no trae queda vacía.
    expect(sheet.getRow(3).getCell(5).value ?? "").toBe("")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "export",
      entityType: "board_data_export",
      newState: expect.objectContaining({ tables: [{ title: "Estado de las pautas hoy", rowCount: 1 }, { title: "Trabajos", rowCount: 2 }] }),
    }))
  })

  it("un equipo del alcance acota «Trabajos»; uno ajeno se ignora", async () => {
    resolveEquipment.mockResolvedValueOnce({ id: "v-1" })
    await exportPanelBoardAction({ ...board, filters: { ...board.filters, equipo: "v-1" } })
    expect(loadWork).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ vehicleId: "v-1" }))
    await exportPanelBoardAction({ ...board, filters: { ...board.filters, equipo: "ajeno" } })
    expect(loadWork.mock.calls.at(-1)![1]).not.toHaveProperty("vehicleId")
  })

  it("rechaza fechas inválidas antes de consultar la sesión", async () => {
    const result = await exportPanelBoardAction({ ...board, filters: { ...board.filters, from: "ayer" } })
    expect(result.ok).toBe(false)
    expect(mockRequirePermission).not.toHaveBeenCalled()
  })

  it("si falla la consulta lo dice sin exponer el error", async () => {
    loadWork.mockRejectedValueOnce(new Error("conexión a postgres://usuario:clave@host"))
    expect(await exportPanelBoardAction(board)).toEqual({ ok: false, message: "No se pudo exportar el tablero. Intenta nuevamente." })
  })
})
