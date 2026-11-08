/**
 * Acciones de la clave de API de Resend (F4): permiso `admin:smtp`, mensajes y
 * que la clave nunca vuelva al cliente. El servicio (cifrado, auditoría, caché)
 * se prueba en `lib/services/__tests__/resend-settings.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  saveResendSettings: vi.fn(),
  clearResendSettings: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/db", () => ({ db: {} }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: mocks.logError, info: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/lib/services/system-settings", () => ({ setEmailsEnabled: vi.fn() }))
vi.mock("@/lib/services/smtp-settings", () => ({ testResendConnection: vi.fn() }))
vi.mock("@/lib/services/resend-settings", () => ({
  saveResendSettings: mocks.saveResendSettings,
  clearResendSettings: mocks.clearResendSettings,
}))

const { saveResendApiKeyAction, restoreResendSettingsAction } = await import("./actions")
const { EncryptedSettingsError } = await import("@/lib/services/encrypted-settings")

const SESSION = { user: { id: "u1", email: "admin@chome.cl" } }
const ACTOR = { userId: "u1", userEmail: "admin@chome.cl" }
const INITIAL = { ok: false }

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePermission.mockResolvedValue(SESSION)
  mocks.saveResendSettings.mockResolvedValue({ changed: true, updated: ["apiKey"], cleared: [] })
  mocks.clearResendSettings.mockResolvedValue({ changed: true })
})

describe("saveResendApiKeyAction", () => {
  it("exige admin:smtp y no toca nada sin el permiso", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("FORBIDDEN"))
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_new_key" }))
    expect(mocks.requirePermission).toHaveBeenCalledWith("admin:smtp")
    expect(result).toEqual({ ok: false, message: "Sin permisos para configurar el correo" })
    expect(mocks.saveResendSettings).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("guarda la clave recortada con el actor y refresca la pantalla", async () => {
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "  re_new_key \n" }))
    expect(mocks.saveResendSettings).toHaveBeenCalledWith({ apiKey: "re_new_key", clearApiKey: false }, ACTOR)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/correo-smtp")
    expect(result).toEqual({ ok: true, message: "Clave de Resend guardada" })
  })

  it("jamás devuelve la clave en la respuesta", async () => {
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_super_secret_key" }))
    expect(JSON.stringify(result)).not.toContain("re_super_secret_key")
  })

  it("«Borrar» pasa la bandera y lo dice con claridad", async () => {
    mocks.saveResendSettings.mockResolvedValue({ changed: true, updated: [], cleared: ["apiKey"] })
    const result = await saveResendApiKeyAction(INITIAL, form({ clearApiKey: "on" }))
    expect(mocks.saveResendSettings).toHaveBeenCalledWith({ apiKey: "", clearApiKey: true }, ACTOR)
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/borrada/i)
  })

  it("sin escribir nada ni marcar «Borrar» no llama al servicio", async () => {
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "   " }))
    expect(mocks.saveResendSettings).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, message: "No hay cambios que guardar" })
  })

  it("si el servicio no cambió nada lo informa", async () => {
    mocks.saveResendSettings.mockResolvedValue({ changed: false, updated: [], cleared: [] })
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_same_key" }))
    expect(result).toEqual({ ok: true, message: "No hay cambios que guardar" })
  })

  it("rechaza una clave con espacios en medio sin llegar al servicio", async () => {
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_new key" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/formato válido/i)
    expect(mocks.saveResendSettings).not.toHaveBeenCalled()
  })

  it("sin llavero explica el motivo y no refresca como si hubiera guardado", async () => {
    mocks.saveResendSettings.mockRejectedValue(new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED"))
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_new_key" }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("llavero")
    expect(result.message).toContain("DTE_SETTINGS_KEYRING")
    expect(result.message).not.toContain("SETTINGS_KEYRING_REQUIRED")
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("escribir y borrar a la vez tiene su propio mensaje", async () => {
    mocks.saveResendSettings.mockRejectedValue(new EncryptedSettingsError("SETTINGS_FIELD_CONFLICT"))
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_new_key", clearApiKey: "on" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Borrar/)
  })

  it("un error del driver no se filtra al cliente", async () => {
    const driverError = Object.assign(new Error("Failed query: insert into system_settings ... params: re_new_key"), {
      query: "insert into system_settings",
    })
    mocks.saveResendSettings.mockRejectedValue(driverError)
    const result = await saveResendApiKeyAction(INITIAL, form({ apiKey: "re_new_key" }))
    expect(result).toEqual({ ok: false, message: "No fue posible guardar la clave de Resend." })
  })
})

describe("restoreResendSettingsAction", () => {
  it("exige admin:smtp", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("FORBIDDEN"))
    const result = await restoreResendSettingsAction()
    expect(mocks.requirePermission).toHaveBeenCalledWith("admin:smtp")
    expect(result.ok).toBe(false)
    expect(mocks.clearResendSettings).not.toHaveBeenCalled()
  })

  it("borra lo guardado con el actor y refresca la pantalla", async () => {
    const result = await restoreResendSettingsAction()
    expect(mocks.clearResendSettings).toHaveBeenCalledWith(ACTOR)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/correo-smtp")
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/servidor/i)
  })

  it("si falla lo dice y no refresca", async () => {
    mocks.clearResendSettings.mockRejectedValue(new Error("db down"))
    const result = await restoreResendSettingsAction()
    expect(result.ok).toBe(false)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
