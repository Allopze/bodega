import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  revalidatePath: vi.fn(),
  saveSettingsGroup: vi.fn(),
  clearSettingsGroup: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mocks.guardPermission }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}))
vi.mock("@/lib/services/encrypted-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/encrypted-settings")>()),
  saveSettingsGroup: mocks.saveSettingsGroup,
  clearSettingsGroup: mocks.clearSettingsGroup,
}))

const { saveSalesSyncSettingsAction, clearSalesSyncSettingsAction } = await import("./actions")
const { salesSyncSettingsGroup } = await import("@/lib/services/billing/config")

const SESSION = { user: { id: "u1", email: "jefa@chome.cl" } }
const DENIED = { ok: false, message: "No tienes permisos para realizar esta acción" }

function form(syncEnabled: "on" | "" | null) {
  const data = new FormData()
  if (syncEnabled !== null) data.set("syncEnabled", syncEnabled)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardPermission.mockResolvedValue({ session: SESSION, error: null })
  mocks.saveSettingsGroup.mockResolvedValue({ changed: true, updated: ["syncEnabled"], cleared: [] })
  mocks.clearSettingsGroup.mockResolvedValue({ changed: true })
})

describe("saveSalesSyncSettingsAction", () => {
  it("exige billing:manage_sync antes de tocar nada", async () => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: DENIED })

    const result = await saveSalesSyncSettingsAction({ ok: false }, form("on"))

    expect(mocks.guardPermission).toHaveBeenCalledWith("billing:manage_sync")
    expect(result).toEqual(DENIED)
    expect(mocks.saveSettingsGroup).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("enciende: guarda «true» en el grupo, a nombre de quien lo hizo, y revalida la pantalla", async () => {
    const result = await saveSalesSyncSettingsAction({ ok: false }, form("on"))

    expect(mocks.saveSettingsGroup).toHaveBeenCalledWith(
      salesSyncSettingsGroup,
      { set: { syncEnabled: "true" } },
      { userId: "u1", userEmail: "jefa@chome.cl" },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/facturacion/sincronizacion")
    expect(result).toEqual({ ok: true, message: "Sincronización automática de facturas de venta activada." })
  })

  it("apaga: guarda «false» (no lo confunde con «vacío conserva»)", async () => {
    const result = await saveSalesSyncSettingsAction({ ok: false }, form(""))

    expect(mocks.saveSettingsGroup).toHaveBeenCalledWith(
      salesSyncSettingsGroup,
      { set: { syncEnabled: "false" } },
      expect.anything(),
    )
    expect(result).toEqual({ ok: true, message: "Sincronización automática de facturas de venta desactivada." })
  })

  it("un campo ausente cuenta como apagado, no como un valor inválido", async () => {
    await saveSalesSyncSettingsAction({ ok: false }, form(null))

    expect(mocks.saveSettingsGroup).toHaveBeenCalledWith(
      salesSyncSettingsGroup,
      { set: { syncEnabled: "false" } },
      expect.anything(),
    )
  })

  it("avisa cuando guardar no cambió nada", async () => {
    mocks.saveSettingsGroup.mockResolvedValue({ changed: false, updated: [], cleared: [] })

    const result = await saveSalesSyncSettingsAction({ ok: false }, form("on"))

    expect(result).toEqual({ ok: true, message: "Sin cambios: la configuración ya estaba así." })
  })

  it("un fallo de la capa de datos no filtra su mensaje al navegador", async () => {
    mocks.saveSettingsGroup.mockRejectedValue(new Error("connection to 10.0.0.5 refused"))

    const result = await saveSalesSyncSettingsAction({ ok: false }, form("on"))

    expect(result.ok).toBe(false)
    expect(result.message).toBe("No se pudo guardar la configuración de la sincronización de ventas")
    expect(JSON.stringify(result)).not.toContain("10.0.0.5")
    expect(mocks.loggerError).toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("clearSalesSyncSettingsAction", () => {
  it("exige billing:manage_sync", async () => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: DENIED })

    const result = await clearSalesSyncSettingsAction()

    expect(mocks.guardPermission).toHaveBeenCalledWith("billing:manage_sync")
    expect(result).toEqual(DENIED)
    expect(mocks.clearSettingsGroup).not.toHaveBeenCalled()
  })

  it("restaura la configuración del servidor y revalida la pantalla", async () => {
    const result = await clearSalesSyncSettingsAction()

    expect(mocks.clearSettingsGroup).toHaveBeenCalledWith(
      salesSyncSettingsGroup,
      { userId: "u1", userEmail: "jefa@chome.cl" },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/facturacion/sincronizacion")
    expect(result).toEqual({ ok: true, message: "Se restauró la configuración del servidor" })
  })

  it("si la BD falla lo dice sin detalles internos", async () => {
    mocks.clearSettingsGroup.mockRejectedValue(new Error("deadlock detected"))

    const result = await clearSalesSyncSettingsAction()

    expect(result).toEqual({ ok: false, message: "No se pudo restaurar la configuración del servidor" })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
