import { beforeEach, describe, expect, it, vi } from "vitest"
import { todayInChile } from "@/lib/utils"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRequireAny = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn(async () => undefined))
const buildExport = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission, requireAnyPermission: mockRequireAny }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/mantencion/looker/export", () => ({ buildLookerExport: buildExport, LOOKER_EXPORT_MAX_ROWS: 20_000 }))

import { exportLookerPanelAction } from "./looker-export-action"

const session = { user: { id: "u1", email: "jefe@chome.cl", isGlobal: false, worksiteIds: ["ws-1"], permissions: ["mant:export", "mant:records:view_worksite"] } }
const built = {
  base64: "QUJD",
  title: "Panel de mantención · Camiones",
  sheets: [{ title: "Correctivos", rowCount: 30 }, { title: "Conductores", rowCount: 4 }],
  truncated: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePermission.mockResolvedValue(session)
  mockRequireAny.mockResolvedValue(session)
  buildExport.mockResolvedValue(built)
})

describe("exportLookerPanelAction", () => {
  it("exige `mant:export` y, sin él, no consulta ni audita", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden"))
    expect(await exportLookerPanelAction({ tab: "camiones", params: {} })).toEqual({ ok: false, message: "Sin permisos" })
    expect(buildExport).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockRequirePermission).toHaveBeenCalledWith("mant:export")
  })

  it("exige también el permiso de ver las pestañas (`mant:records:view_worksite` o `view_all`), como la página", async () => {
    mockRequireAny.mockRejectedValue(new Error("Forbidden"))
    expect(await exportLookerPanelAction({ tab: "camiones", params: {} })).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockRequireAny).toHaveBeenCalledWith(["mant:records:view_worksite", "mant:records:view_all"])
    expect(buildExport).not.toHaveBeenCalled()
  })

  it("rechaza una pestaña que no es de las tres antes de consultar la sesión", async () => {
    for (const tab of ["hoy", "otra", "", undefined]) {
      const result = await exportLookerPanelAction({ tab, params: {} } as never)
      expect(result.ok, String(tab)).toBe(false)
    }
    expect(mockRequirePermission).not.toHaveBeenCalled()
  })

  it("rechaza parámetros que no son texto o listas de texto, o desmedidos", async () => {
    for (const params of [{ faena: 7 }, { faena: { a: 1 } }, { faena: "x".repeat(3000) }, { faena: Array.from({ length: 200 }, () => "a") }]) {
      expect((await exportLookerPanelAction({ tab: "camiones", params } as never)).ok).toBe(false)
    }
    expect(buildExport).not.toHaveBeenCalled()
  })

  it("pasa al constructor sólo los parámetros que mueven la pantalla: ni `pestana`, ni `page`, ni inventados", async () => {
    await exportLookerPanelAction({
      tab: "camiones",
      params: { pestana: "maquinas", page: "4", desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], x_conductor: "JUAN PEREZ", otro: "1", equipo: undefined },
    })
    expect(buildExport).toHaveBeenCalledWith(session, {
      tab: "camiones",
      params: { desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], x_conductor: "JUAN PEREZ" },
    })
  })

  it("devuelve el libro con su nombre de archivo y deja la auditoría de la exportación", async () => {
    const result = await exportLookerPanelAction({ tab: "camiones", params: { faena: "ws-1" } })
    expect(result).toEqual({ ok: true, data: { base64: "QUJD", filename: `panel_de_mantencion_camiones_${todayInChile()}.xlsx` } })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      userEmail: "jefe@chome.cl",
      action: "export",
      entityType: "board_data_export",
      newState: {
        title: "Panel de mantención · Camiones",
        tab: "camiones",
        params: { faena: "ws-1" },
        tables: [{ title: "Correctivos", rowCount: 30 }, { title: "Conductores", rowCount: 4 }],
        truncated: false,
        permissions: ["mant:export"],
      },
    }))
  })

  it("si el libro se cortó por el tope, el resultado lo declara para que el botón avise", async () => {
    buildExport.mockResolvedValue({ ...built, truncated: true })
    const result = await exportLookerPanelAction({ tab: "maquinas", params: {} })
    expect(result).toMatchObject({ ok: true, data: { truncated: true, rowLimit: 20_000 } })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ newState: expect.objectContaining({ truncated: true }) }))
  })

  it("si falla la consulta lo dice sin exponer el error y no audita", async () => {
    buildExport.mockRejectedValue(new Error("conexión a postgres://usuario:clave@host"))
    expect(await exportLookerPanelAction({ tab: "planificacion", params: {} })).toEqual({ ok: false, message: "No se pudo exportar el panel. Intenta nuevamente." })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
