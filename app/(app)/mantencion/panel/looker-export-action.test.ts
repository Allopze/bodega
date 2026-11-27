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
  title: "Panel de mantención · Correctivo · Por kilómetros",
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
    expect(await exportLookerPanelAction({ tab: "correctivo", params: {} })).toEqual({ ok: false, message: "Sin permisos" })
    expect(buildExport).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockRequirePermission).toHaveBeenCalledWith("mant:export")
  })

  it("exige también el permiso de ver las pestañas (`mant:records:view_worksite` o `view_all`), como la página", async () => {
    mockRequireAny.mockRejectedValue(new Error("Forbidden"))
    expect(await exportLookerPanelAction({ tab: "correctivo", params: {} })).toEqual({ ok: false, message: "Sin permisos" })
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
      expect((await exportLookerPanelAction({ tab: "correctivo", params } as never)).ok).toBe(false)
    }
    expect(buildExport).not.toHaveBeenCalled()
  })

  describe("tope de valores por filtro (faena, equipo y frecuencia)", () => {
    const ids = (count: number, prefix = "ws-") => Array.from({ length: count }, (_, index) => `${prefix}${index}`)
    const INVALID = { ok: false, message: "El panel no se pudo exportar: sus datos no son válidos." }

    it("justo en el límite (100 valores) pasa; uno más falla con el mensaje de siempre y no consulta ni audita", async () => {
      for (const key of ["faena", "equipo", "frecuencia"]) {
        expect((await exportLookerPanelAction({ tab: "correctivo", params: { [key]: ids(100).join(",") } })).ok, `${key}: 100`).toBe(true)
        expect(await exportLookerPanelAction({ tab: "correctivo", params: { [key]: ids(101).join(",") } }), `${key}: 101`).toEqual(INVALID)
      }
      expect(buildExport).toHaveBeenCalledTimes(3)
      expect(mockRecordAudit).toHaveBeenCalledTimes(3)
    })

    it("el tope cuenta los valores DESPUÉS de partir por comas, también repartidos en una lista", async () => {
      // Una sola cadena de 2000 caracteres puede traer cientos de ids: el tope no es el largo del texto.
      expect(await exportLookerPanelAction({ tab: "correctivo", params: { faena: ids(300, "w").join(",").slice(0, 1900) } })).toEqual(INVALID)
      // 50 + 50 valores en dos entradas de la lista: pasa; 50 + 51: no.
      expect((await exportLookerPanelAction({ tab: "correctivo", params: { faena: [ids(50, "a").join(","), ids(50, "b").join(",")] } })).ok).toBe(true)
      expect(await exportLookerPanelAction({ tab: "correctivo", params: { faena: [ids(50, "a").join(","), ids(51, "b").join(",")] } })).toEqual(INVALID)
      // Los separadores sobrantes y los vacíos no cuentan como valores.
      expect((await exportLookerPanelAction({ tab: "correctivo", params: { faena: `${ids(100).join(",,")},` } })).ok).toBe(true)
    })

    it("los valores repetidos cuentan cada vez: el tope acota también lo que queda en la auditoría", async () => {
      expect(await exportLookerPanelAction({ tab: "correctivo", params: { faena: Array.from({ length: 101 }, () => "ws-1").join(",") } })).toEqual(INVALID)
    })

    it("no limita a los filtros de un solo valor (período y filtros cruzados)", async () => {
      expect((await exportLookerPanelAction({ tab: "correctivo", params: { desde: "2026-10-01", x_conductor: "JUAN, PEREZ, SOTO" } })).ok).toBe(true)
    })
  })

  it("pasa al constructor sólo los parámetros que mueven la pantalla: ni `pestana`, ni `page`, ni inventados", async () => {
    await exportLookerPanelAction({
      tab: "correctivo",
      params: { pestana: "preventivo", page: "4", ficha: "v-1", unidad: "h", desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], x_conductor: "JUAN PEREZ", otro: "1", equipo: undefined },
    })
    expect(buildExport).toHaveBeenCalledWith(session, {
      tab: "correctivo",
      params: { unidad: "h", desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], x_conductor: "JUAN PEREZ" },
    })
  })

  it("acepta las tres pestañas nuevas y lleva los filtros de Planificación", async () => {
    for (const tab of ["planificacion", "correctivo", "preventivo"] as const) {
      expect((await exportLookerPanelAction({ tab, params: {} })).ok, tab).toBe(true)
    }
    await exportLookerPanelAction({ tab: "planificacion", params: { estado: "vencida", fecha: "ultima", fecha_desde: "2026-06-01", fecha_hasta: "2026-09-30" } })
    expect(buildExport).toHaveBeenLastCalledWith(session, {
      tab: "planificacion",
      params: { estado: "vencida", fecha: "ultima", fecha_desde: "2026-06-01", fecha_hasta: "2026-09-30" },
    })
    expect(await exportLookerPanelAction({ tab: "hoy" as never, params: {} })).toEqual({ ok: false, message: "El panel no se pudo exportar: sus datos no son válidos." })
  })

  it("un botón viejo con `camiones` o `maquinas` sigue exportando: Correctivo en su unidad", async () => {
    await exportLookerPanelAction({ tab: "camiones", params: { faena: "ws-1", unidad: "h" } })
    expect(buildExport).toHaveBeenLastCalledWith(session, { tab: "correctivo", params: { faena: "ws-1", unidad: "km" } })
    await exportLookerPanelAction({ tab: "maquinas", params: { faena: "ws-1" } })
    expect(buildExport).toHaveBeenLastCalledWith(session, { tab: "correctivo", params: { faena: "ws-1", unidad: "h" } })
  })

  it("devuelve el libro con su nombre de archivo y deja la auditoría de la exportación", async () => {
    const result = await exportLookerPanelAction({ tab: "correctivo", params: { faena: "ws-1" } })
    expect(result).toEqual({ ok: true, data: { base64: "QUJD", filename: `panel_de_mantencion_correctivo_por_kilometros_${todayInChile()}.xlsx` } })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      userEmail: "jefe@chome.cl",
      action: "export",
      entityType: "board_data_export",
      newState: {
        title: "Panel de mantención · Correctivo · Por kilómetros",
        tab: "correctivo",
        params: { faena: "ws-1" },
        tables: [{ title: "Correctivos", rowCount: 30 }, { title: "Conductores", rowCount: 4 }],
        truncated: false,
        permissions: ["mant:export"],
      },
    }))
  })

  it("si el libro se cortó por el tope, el resultado lo declara para que el botón avise", async () => {
    buildExport.mockResolvedValue({ ...built, truncated: true })
    const result = await exportLookerPanelAction({ tab: "preventivo", params: {} })
    expect(result).toMatchObject({ ok: true, data: { truncated: true, rowLimit: 20_000 } })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ newState: expect.objectContaining({ truncated: true }) }))
  })

  it("si falla la consulta lo dice sin exponer el error y no audita", async () => {
    buildExport.mockRejectedValue(new Error("conexión a postgres://usuario:clave@host"))
    expect(await exportLookerPanelAction({ tab: "planificacion", params: {} })).toEqual({ ok: false, message: "No se pudo exportar el panel. Intenta nuevamente." })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
