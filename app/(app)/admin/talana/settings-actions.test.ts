import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  revalidatePath: vi.fn(),
  saveTalanaSettings: vi.fn(),
  clearTalanaSettings: vi.fn(),
  loadTalanaConfig: vi.fn(),
  ping: vi.fn(),
  createTalanaClient: vi.fn(),
  consumeFixedWindowLimit: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mocks.guardPermission }))
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.loggerError, warn: mocks.loggerWarn, info: vi.fn() } }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: mocks.consumeFixedWindowLimit }))
vi.mock("@/lib/integrations/talana/talana-settings", () => ({
  saveTalanaSettings: mocks.saveTalanaSettings,
  clearTalanaSettings: mocks.clearTalanaSettings,
  loadTalanaConfig: mocks.loadTalanaConfig,
}))
vi.mock("@/lib/integrations/talana/talana-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/talana/talana-client")>()),
  createTalanaClient: mocks.createTalanaClient,
}))

import { TalanaClientError } from "@/lib/integrations/talana/talana-client"
import { EncryptedSettingsError } from "@/lib/services/encrypted-settings"
import { clearTalanaSettingsAction, saveTalanaSettingsAction, testTalanaConnectionAction } from "./settings-actions"

const FAKE_TOKEN = "tok-falso-0123456789abcdef"

function session(): Session {
  return {
    user: {
      id: "admin-1", name: "Admin", email: "admin@test.cl", roles: [], permissions: ["admin:talana_settings"],
      worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session
}

const DENIED = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const CONFIG_OK = {
  token: FAKE_TOKEN, mode: "simulate", hasCredentials: true, enabled: true,
  sources: { token: "system_settings", mode: "system_settings" }, tokenUnreadable: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardPermission.mockResolvedValue({ session: session(), error: null })
  mocks.saveTalanaSettings.mockResolvedValue({ changed: true, updated: ["mode"], cleared: [] })
  mocks.clearTalanaSettings.mockResolvedValue({ changed: true })
  mocks.loadTalanaConfig.mockResolvedValue(CONFIG_OK)
  mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: true, remaining: 2 })
  mocks.ping.mockResolvedValue({ ok: true, contractCount: 412 })
  mocks.createTalanaClient.mockReturnValue({ ping: mocks.ping })
})

describe("permiso admin:talana_settings", () => {
  it("las tres acciones lo exigen y, sin él, no tocan nada", async () => {
    mocks.guardPermission.mockResolvedValue(DENIED)

    const save = await saveTalanaSettingsAction({ ok: false }, form({ apiToken: FAKE_TOKEN, mode: "apply" }))
    const clear = await clearTalanaSettingsAction()
    const test = await testTalanaConnectionAction()

    for (const result of [save, clear, test]) {
      expect(result).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    }
    expect(mocks.guardPermission).toHaveBeenCalledTimes(3)
    for (const call of mocks.guardPermission.mock.calls) expect(call).toEqual(["admin:talana_settings", "/admin/talana"])
    expect(mocks.saveTalanaSettings).not.toHaveBeenCalled()
    expect(mocks.clearTalanaSettings).not.toHaveBeenCalled()
    expect(mocks.loadTalanaConfig).not.toHaveBeenCalled()
    expect(mocks.consumeFixedWindowLimit).not.toHaveBeenCalled()
    expect(mocks.createTalanaClient).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("saveTalanaSettingsAction", () => {
  it("guarda el token recortado y el modo, a nombre de quien actúa, y revalida la pantalla", async () => {
    mocks.saveTalanaSettings.mockResolvedValue({ changed: true, updated: ["apiToken", "mode"], cleared: [] })

    const result = await saveTalanaSettingsAction({ ok: false }, form({ apiToken: `  ${FAKE_TOKEN}\n`, mode: "apply" }))

    expect(result).toEqual({ ok: true, message: "Configuración de Talana guardada." })
    expect(mocks.saveTalanaSettings).toHaveBeenCalledWith(
      { apiToken: FAKE_TOKEN, clearApiToken: false, mode: "apply" },
      { userId: "admin-1", userEmail: "admin@test.cl" },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/talana")
  })

  it("sin modo en el formulario conserva el modo: no lo manda al servicio", async () => {
    await saveTalanaSettingsAction({ ok: false }, form({ apiToken: FAKE_TOKEN }))
    expect(mocks.saveTalanaSettings).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: FAKE_TOKEN, mode: undefined }),
      expect.anything(),
    )
  })

  it("el borrado del token es explícito y se pasa al servicio", async () => {
    await saveTalanaSettingsAction({ ok: false }, form({ clearApiToken: "on" }))
    expect(mocks.saveTalanaSettings).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "", clearApiToken: true }),
      expect.anything(),
    )
  })

  it.each([
    ["un modo que no existe", { mode: "aplicar" }, /modo de sincronización no es válido/],
    ["un token con espacios en medio", { apiToken: "abc def" }, /espacios o caracteres no válidos/],
    ["un token con salto de línea en medio", { apiToken: "abc\ndef" }, /espacios o caracteres no válidos/],
    ["un token con caracteres fuera de ASCII", { apiToken: "tokén" }, /espacios o caracteres no válidos/],
    ["un token enorme", { apiToken: "a".repeat(501) }, /demasiado largo/],
    ["escribir y borrar el token a la vez", { apiToken: FAKE_TOKEN, clearApiToken: "on" }, /escribir un token nuevo y borrar/],
  ])("rechaza %s antes de tocar nada", async (_label, fields, message) => {
    const result = await saveTalanaSettingsAction({ ok: false }, form(fields))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(message)
    expect(mocks.saveTalanaSettings).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("un guardado que no cambia nada lo dice sin avisar de éxito falso", async () => {
    mocks.saveTalanaSettings.mockResolvedValue({ changed: false, updated: [], cleared: [] })
    const result = await saveTalanaSettingsAction({ ok: false }, form({}))
    expect(result).toEqual({ ok: true, message: "No había cambios que guardar." })
  })

  it("avisa si el modo quedó activo pero falta el token", async () => {
    mocks.loadTalanaConfig.mockResolvedValue({ ...CONFIG_OK, token: "", hasCredentials: false, enabled: false, mode: "apply" })
    const result = await saveTalanaSettingsAction({ ok: false }, form({ mode: "apply" }))
    expect(result.ok).toBe(true)
    expect(result.message).toContain("falta el token")
  })

  it("avisa si el token guardado no se puede abrir con el llavero", async () => {
    mocks.loadTalanaConfig.mockResolvedValue({ ...CONFIG_OK, token: "", hasCredentials: false, enabled: false, tokenUnreadable: true })
    const result = await saveTalanaSettingsAction({ ok: false }, form({ mode: "simulate" }))
    expect(result.message).toContain("no se puede abrir")
  })

  it("sin llavero dice que no se guardó nada y cómo seguir, sin filtrar el error ni el token", async () => {
    mocks.saveTalanaSettings.mockRejectedValue(new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED"))
    const result = await saveTalanaSettingsAction({ ok: false }, form({ apiToken: FAKE_TOKEN, mode: "apply" }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("no tiene el llavero de cifrado")
    expect(result.message).toContain("no se guardó nada")
    expect(result.message).toContain("DTE_SETTINGS_KEYRING")
    expect(result.message).not.toContain(FAKE_TOKEN)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("un error inesperado no se propaga: mensaje genérico y el log sólo lleva el nombre del error", async () => {
    mocks.saveTalanaSettings.mockRejectedValue(new Error(`boom con ${FAKE_TOKEN}`))
    const result = await saveTalanaSettingsAction({ ok: false }, form({ apiToken: FAKE_TOKEN }))
    expect(result).toEqual({ ok: false, message: "No se pudo guardar la configuración de Talana." })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(FAKE_TOKEN)
  })
})

describe("clearTalanaSettingsAction", () => {
  it("restaura la configuración del servidor y revalida la pantalla", async () => {
    const result = await clearTalanaSettingsAction()
    expect(result).toEqual({ ok: true, message: "Se restauró la configuración del servidor." })
    expect(mocks.clearTalanaSettings).toHaveBeenCalledWith({ userId: "admin-1", userEmail: "admin@test.cl" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/talana")
  })

  it("si falla, lo dice sin detalles internos", async () => {
    mocks.clearTalanaSettings.mockRejectedValue(new Error("Failed query: delete from system_settings"))
    const result = await clearTalanaSettingsAction()
    expect(result).toEqual({ ok: false, message: "No se pudo restaurar la configuración del servidor." })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe("testTalanaConnectionAction", () => {
  it("prueba con el token vigente, limitado a 3 pruebas cada 10 minutos por persona, y dice cuántos contratos ve", async () => {
    const result = await testTalanaConnectionAction()

    expect(result).toEqual({
      ok: true,
      message: "Conexión correcta: Talana aceptó el token. La cuenta tiene 412 contratos registrados.",
    })
    expect(mocks.consumeFixedWindowLimit).toHaveBeenCalledWith("talana-test:admin-1", { maxAttempts: 3, lockMs: 600_000 })
    expect(mocks.createTalanaClient).toHaveBeenCalledWith({ token: FAKE_TOKEN })
    expect(mocks.ping).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN)
  })

  it("sin conteo declarado igual confirma la conexión", async () => {
    mocks.ping.mockResolvedValue({ ok: true, contractCount: null })
    expect(await testTalanaConnectionAction()).toEqual({ ok: true, message: "Conexión correcta: Talana aceptó el token." })
  })

  it("sin token no gasta una consulta ni una prueba del límite", async () => {
    mocks.loadTalanaConfig.mockResolvedValue({ ...CONFIG_OK, token: "", hasCredentials: false, enabled: false })
    const result = await testTalanaConnectionAction()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("No hay token configurado")
    expect(mocks.consumeFixedWindowLimit).not.toHaveBeenCalled()
    expect(mocks.createTalanaClient).not.toHaveBeenCalled()
  })

  it("con el token guardado ilegible lo dice en vez de probar con el del servidor", async () => {
    mocks.loadTalanaConfig.mockResolvedValue({ ...CONFIG_OK, token: "", hasCredentials: false, enabled: false, tokenUnreadable: true })
    const result = await testTalanaConnectionAction()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("no se puede abrir con el llavero")
    expect(mocks.createTalanaClient).not.toHaveBeenCalled()
  })

  it("pasado el límite no consulta a Talana", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const result = await testTalanaConnectionAction()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("espera unos 10 minutos")
    expect(mocks.createTalanaClient).not.toHaveBeenCalled()
    expect(mocks.ping).not.toHaveBeenCalled()
  })

  it.each([
    ["TALANA_AUTH_FAILED", 401, /rechazó el token/],
    ["TALANA_RATE_LIMITED", 429, /bloquea esta dirección por unos 10 minutos/],
    ["TALANA_TIMEOUT", undefined, /no respondió a tiempo/],
    ["TALANA_BAD_RESPONSE", undefined, /formato inesperado/],
    ["TALANA_HTTP_ERROR", 502, /HTTP 502/],
    ["TALANA_HTTP_ERROR", undefined, /No se pudo conectar con Talana/],
  ] as const)("traduce %s (%s) a un mensaje en español, sin el token ni el cuerpo del proveedor", async (code, status, message) => {
    mocks.ping.mockRejectedValue(new TalanaClientError(code, status))
    const result = await testTalanaConnectionAction()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(message)
    expect(result.message).not.toContain(FAKE_TOKEN)
    expect(result.message).not.toContain(code)
    // Se registra el código y el estado HTTP; nunca el token.
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(FAKE_TOKEN)
  })

  it("un error desconocido no se propaga: mensaje genérico y el log sólo lleva el nombre del error", async () => {
    mocks.ping.mockRejectedValue(new Error(`boom con ${FAKE_TOKEN}`))
    const result = await testTalanaConnectionAction()
    expect(result).toEqual({ ok: false, message: "No se pudo probar la conexión con Talana." })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(FAKE_TOKEN)
  })
})
