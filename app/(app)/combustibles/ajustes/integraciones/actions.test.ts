import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  revalidatePath: vi.fn(),
  consumeFixedWindowLimit: vi.fn(),
  saveCopecSettings: vi.fn(),
  clearCopecSettings: vi.fn(),
  loadCopecConfig: vi.fn(),
  withCopecWebServiceSession: vi.fn(),
  saveVisionLinkSettings: vi.fn(),
  clearVisionLinkSettings: vi.fn(),
  loadVisionLinkConfig: vi.fn(),
  verifyVisionLinkCredentials: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => Reflect.apply(mocks.revalidatePath, null, args) }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: (...args: unknown[]) => Reflect.apply(mocks.guardPermission, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))
vi.mock("@/lib/logger", () => ({ logger: { warn: () => {}, error: () => {}, info: () => {} } }))
vi.mock("@/lib/combustibles/copec-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/combustibles/copec-settings")>()),
  saveCopecSettings: (...args: unknown[]) => Reflect.apply(mocks.saveCopecSettings, null, args),
  clearCopecSettings: (...args: unknown[]) => Reflect.apply(mocks.clearCopecSettings, null, args),
  loadCopecConfig: (...args: unknown[]) => Reflect.apply(mocks.loadCopecConfig, null, args),
}))
vi.mock("@/lib/combustibles/copec-ws", () => ({
  withCopecWebServiceSession: (...args: unknown[]) => Reflect.apply(mocks.withCopecWebServiceSession, null, args),
}))
vi.mock("@/lib/integrations/visionlink/visionlink-settings", () => ({
  saveVisionLinkSettings: (...args: unknown[]) => Reflect.apply(mocks.saveVisionLinkSettings, null, args),
  clearVisionLinkSettings: (...args: unknown[]) => Reflect.apply(mocks.clearVisionLinkSettings, null, args),
  loadVisionLinkConfig: (...args: unknown[]) => Reflect.apply(mocks.loadVisionLinkConfig, null, args),
}))
vi.mock("@/lib/integrations/visionlink/visionlink-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/visionlink/visionlink-client")>()),
  verifyVisionLinkCredentials: (...args: unknown[]) => Reflect.apply(mocks.verifyVisionLinkCredentials, null, args),
}))

const actions = await import("./actions")
const { CopecSettingsError } = await import("@/lib/combustibles/copec-settings")
const { EncryptedSettingsError } = await import("@/lib/services/encrypted-settings")
const { VisionLinkClientError } = await import("@/lib/integrations/visionlink/visionlink-client")

const DENIED = { ok: false, message: "No tienes permisos para realizar esta acción" }
const SESSION = { user: { id: "u1", email: "jefa@chome.cl" } }

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardPermission.mockResolvedValue({ session: SESSION, error: null })
  mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: true, remaining: 2 })
  mocks.saveCopecSettings.mockResolvedValue({ changed: true, updated: [], cleared: [] })
  mocks.clearCopecSettings.mockResolvedValue({ changed: true })
  mocks.loadCopecConfig.mockResolvedValue({ syncEnabled: true, hasCredentials: true, importerEmail: "importador@chome.cl" })
  mocks.saveVisionLinkSettings.mockResolvedValue({ changed: true, updated: [], cleared: [] })
  mocks.clearVisionLinkSettings.mockResolvedValue({ changed: true })
  mocks.loadVisionLinkConfig.mockResolvedValue({ clientId: "id", clientSecret: "secreto", scope: "", syncEnabled: true, hasCredentials: true })
  mocks.verifyVisionLinkCredentials.mockResolvedValue(undefined)
  mocks.withCopecWebServiceSession.mockImplementation(async (run: (session: unknown) => Promise<unknown>) =>
    run({ download: async () => [{ product: "diesel", unavailable: false, report: { records: [{}, {}] } }] }))
})

describe("permiso", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["saveCopecSettingsAction", () => actions.saveCopecSettingsAction({ ok: false }, form({}))],
    ["clearCopecSettingsAction", () => actions.clearCopecSettingsAction()],
    ["testCopecConnectionAction", () => actions.testCopecConnectionAction()],
    ["saveVisionLinkSettingsAction", () => actions.saveVisionLinkSettingsAction({ ok: false }, form({}))],
    ["clearVisionLinkSettingsAction", () => actions.clearVisionLinkSettingsAction()],
    ["testVisionLinkConnectionAction", () => actions.testVisionLinkConnectionAction()],
  ]

  it.each(cases)("%s exige combustibles:manage_integrations y no toca nada sin él", async (_name, run) => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: DENIED })
    await expect(run()).resolves.toEqual(DENIED)
    expect(mocks.guardPermission).toHaveBeenCalledWith("combustibles:manage_integrations", expect.any(String))
    for (const mock of [
      mocks.saveCopecSettings, mocks.clearCopecSettings, mocks.withCopecWebServiceSession,
      mocks.saveVisionLinkSettings, mocks.clearVisionLinkSettings, mocks.verifyVisionLinkCredentials,
      mocks.consumeFixedWindowLimit, mocks.revalidatePath,
    ]) expect(mock).not.toHaveBeenCalled()
  })
})

describe("saveCopecSettingsAction", () => {
  it("manda lo escrito al servicio, atribuye el cambio a quien lo hizo y revalida la pantalla", async () => {
    const result = await actions.saveCopecSettingsAction({ ok: false }, form({
      username: " usuario ", password: "clave", clientRut: "76123456-0", importerEmail: "a@chome.cl", syncEnabled: "on", clearUsername: "",
    }))
    expect(result).toMatchObject({ ok: true, message: "Configuración de Copec guardada." })
    expect(mocks.saveCopecSettings).toHaveBeenCalledWith(
      { username: "usuario", password: "clave", clientRut: "76123456-0", importerEmail: "a@chome.cl", syncEnabled: true, clearUsername: false, clearPassword: false },
      { userId: "u1", userEmail: "jefa@chome.cl" },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/combustibles/ajustes/integraciones")
  })

  it("sin cambios lo dice en vez de prometer un guardado", async () => {
    mocks.saveCopecSettings.mockResolvedValue({ changed: false, updated: [], cleared: [] })
    expect(await actions.saveCopecSettingsAction({ ok: false }, form({}))).toMatchObject({ ok: true, message: expect.stringContaining("No había cambios") })
  })

  it("rechaza escribir y borrar el mismo secreto a la vez antes de llegar al servicio", async () => {
    const result = await actions.saveCopecSettingsAction({ ok: false }, form({ password: "clave", clearPassword: "on" }))
    expect(result).toMatchObject({ ok: false })
    expect(mocks.saveCopecSettings).not.toHaveBeenCalled()
  })

  it("rechaza un envío deformado antes de llegar a la capa de cifrado", async () => {
    const result = await actions.saveCopecSettingsAction({ ok: false }, form({ password: "x".repeat(501) }))
    expect(result).toEqual({ ok: false, message: "La contraseña es demasiado larga" })
    expect(mocks.saveCopecSettings).not.toHaveBeenCalled()
  })

  it("sin llavero dice por qué y qué hacer, sin filtrar el error", async () => {
    mocks.saveCopecSettings.mockRejectedValue(new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED"))
    const result = await actions.saveCopecSettingsAction({ ok: false }, form({ password: "clave" }))
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("DTE_SETTINGS_KEYRING") })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("muestra el motivo de una validación (RUT, usuario de la corrida) y esconde un error interno", async () => {
    mocks.saveCopecSettings.mockRejectedValueOnce(new CopecSettingsError("COPEC_RUT_INVALID", "El RUT de la empresa tiene el dígito verificador incorrecto."))
    expect(await actions.saveCopecSettingsAction({ ok: false }, form({ clientRut: "1-1" }))).toEqual({
      ok: false,
      message: "El RUT de la empresa tiene el dígito verificador incorrecto.",
    })

    mocks.saveCopecSettings.mockRejectedValueOnce(new Error("Failed query: insert into system_settings ... params: clave-secreta"))
    const result = await actions.saveCopecSettingsAction({ ok: false }, form({ password: "clave-secreta" }))
    expect(result).toEqual({ ok: false, message: "No se pudo guardar la configuración de Copec" })
  })

  it("avisa al guardar si la actualización queda activa pero no puede correr", async () => {
    mocks.loadCopecConfig.mockResolvedValue({ syncEnabled: true, hasCredentials: false, importerEmail: "a@chome.cl" })
    expect(await actions.saveCopecSettingsAction({ ok: false }, form({ syncEnabled: "on" }))).toMatchObject({ message: expect.stringContaining("faltan credenciales") })
    mocks.loadCopecConfig.mockResolvedValue({ syncEnabled: true, hasCredentials: true, importerEmail: "" })
    expect(await actions.saveCopecSettingsAction({ ok: false }, form({ syncEnabled: "on" }))).toMatchObject({ message: expect.stringContaining("falta el usuario que registra") })
    mocks.loadCopecConfig.mockResolvedValue({ syncEnabled: false, hasCredentials: false, importerEmail: "" })
    expect((await actions.saveCopecSettingsAction({ ok: false }, form({}))).message).not.toContain("Ojo")
  })
})

describe("saveVisionLinkSettingsAction", () => {
  it("manda lo escrito al servicio y revalida la pantalla", async () => {
    const result = await actions.saveVisionLinkSettingsAction({ ok: false }, form({ clientId: "id", clientSecret: "secreto", scope: "", syncEnabled: "on" }))
    expect(result).toMatchObject({ ok: true, message: "Configuración de VisionLink guardada." })
    expect(mocks.saveVisionLinkSettings).toHaveBeenCalledWith(
      { clientId: "id", clientSecret: "secreto", scope: "", syncEnabled: true, clearClientSecret: false },
      { userId: "u1", userEmail: "jefa@chome.cl" },
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/combustibles/ajustes/integraciones")
  })

  it("sin llavero dice por qué y qué hacer", async () => {
    mocks.saveVisionLinkSettings.mockRejectedValue(new EncryptedSettingsError("SETTINGS_KEYRING_REQUIRED"))
    expect(await actions.saveVisionLinkSettingsAction({ ok: false }, form({ clientSecret: "secreto" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("llavero"),
    })
  })

  it("rechaza escribir y borrar el secreto a la vez, y esconde un error interno", async () => {
    expect(await actions.saveVisionLinkSettingsAction({ ok: false }, form({ clientSecret: "s", clearClientSecret: "on" }))).toMatchObject({ ok: false })
    expect(mocks.saveVisionLinkSettings).not.toHaveBeenCalled()
    mocks.saveVisionLinkSettings.mockRejectedValue(new Error("connection refused 10.0.0.5"))
    expect(await actions.saveVisionLinkSettingsAction({ ok: false }, form({}))).toEqual({ ok: false, message: "No se pudo guardar la configuración de VisionLink" })
  })

  it("avisa si la actualización queda activa sin credenciales", async () => {
    mocks.loadVisionLinkConfig.mockResolvedValue({ syncEnabled: true, hasCredentials: false })
    expect(await actions.saveVisionLinkSettingsAction({ ok: false }, form({ syncEnabled: "on" }))).toMatchObject({ message: expect.stringContaining("faltan credenciales") })
  })
})

describe("restaurar la configuración del servidor", () => {
  it("borra lo guardado y revalida la pantalla", async () => {
    expect(await actions.clearCopecSettingsAction()).toEqual({ ok: true, message: "Se restauró la configuración del servidor" })
    expect(await actions.clearVisionLinkSettingsAction()).toEqual({ ok: true, message: "Se restauró la configuración del servidor" })
    expect(mocks.clearCopecSettings).toHaveBeenCalledWith({ userId: "u1", userEmail: "jefa@chome.cl" })
    expect(mocks.clearVisionLinkSettings).toHaveBeenCalledWith({ userId: "u1", userEmail: "jefa@chome.cl" })
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2)
  })

  it("si falla, no filtra el error", async () => {
    mocks.clearCopecSettings.mockRejectedValue(new Error("db password=clave"))
    expect(await actions.clearCopecSettingsAction()).toEqual({ ok: false, message: "No se pudo restaurar la configuración del servidor" })
  })
})

describe("testVisionLinkConnectionAction", () => {
  it("se acota a 3 pruebas cada 10 minutos por persona y no llama al proveedor al pasarse", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    expect(await actions.testVisionLinkConnectionAction()).toMatchObject({ ok: false, message: expect.stringContaining("demasiadas veces") })
    expect(mocks.consumeFixedWindowLimit).toHaveBeenCalledWith("visionlink-test:u1", { maxAttempts: 3, lockMs: 600_000 })
    expect(mocks.verifyVisionLinkCredentials).not.toHaveBeenCalled()
  })

  it("prueba lo guardado: sólo pide el token con la configuración vigente", async () => {
    expect(await actions.testVisionLinkConnectionAction()).toMatchObject({ ok: true })
    expect(mocks.verifyVisionLinkCredentials).toHaveBeenCalledWith(expect.objectContaining({ clientId: "id", clientSecret: "secreto" }))
  })

  it("sin credenciales lo dice sin salir a la red", async () => {
    mocks.loadVisionLinkConfig.mockResolvedValue({ clientId: "", clientSecret: "", scope: "", syncEnabled: false, hasCredentials: false })
    expect(await actions.testVisionLinkConnectionAction()).toMatchObject({ ok: false, message: expect.stringContaining("Faltan credenciales") })
    expect(mocks.verifyVisionLinkCredentials).not.toHaveBeenCalled()
  })

  it("traduce cada falla del proveedor sin repetir credenciales ni el cuerpo de la respuesta", async () => {
    const expectations: Array<[unknown, RegExp]> = [
      [new VisionLinkClientError("VISIONLINK_AUTH_FAILED", 401), /rechazó las credenciales/],
      [new VisionLinkClientError("VISIONLINK_RATE_LIMITED", 429), /limitó/],
      [new VisionLinkClientError("VISIONLINK_TIMEOUT"), /no respondió a tiempo/],
      [new VisionLinkClientError("VISIONLINK_HTTP_ERROR", 500), /respondió con un error/],
      [new TypeError("fetch failed: https://login.microsoftonline.com/?client_secret=secreto"), /No fue posible conectar/],
    ]
    for (const [error, pattern] of expectations) {
      mocks.verifyVisionLinkCredentials.mockRejectedValueOnce(error)
      const result = await actions.testVisionLinkConnectionAction()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(pattern)
      expect(result.message).not.toContain("secreto")
      expect(result.message).not.toContain("microsoftonline")
    }
  })
})

describe("testCopecConnectionAction", () => {
  it("se acota a 3 pruebas cada 10 minutos por persona y no llama a Copec al pasarse", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    expect(await actions.testCopecConnectionAction()).toMatchObject({ ok: false, message: expect.stringContaining("demasiadas veces") })
    expect(mocks.consumeFixedWindowLimit).toHaveBeenCalledWith("copec-test:u1", { maxAttempts: 3, lockMs: 600_000 })
    expect(mocks.withCopecWebServiceSession).not.toHaveBeenCalled()
  })

  it("hace una sola consulta de un día y la acota con un plazo propio", async () => {
    const download = vi.fn(async () => [{ product: "diesel", unavailable: false, report: { records: [] } }])
    mocks.withCopecWebServiceSession.mockImplementation(async (run: (session: unknown) => Promise<unknown>) => run({ download }))
    expect(await actions.testCopecConnectionAction()).toMatchObject({ ok: true, message: expect.stringContaining("Conexión correcta") })
    expect(download).toHaveBeenCalledTimes(1)
    const calls = download.mock.calls as unknown as Array<[Array<{ product: string; from: string; to: string }>, string]>
    const [requests, channel] = calls[0]!
    expect(channel).toBe("TCT")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ product: "diesel" })
    expect(requests[0]!.from).toBe(requests[0]!.to)
    expect(mocks.withCopecWebServiceSession.mock.calls[0]![1]).toEqual({ deadline: expect.any(Number) })
  })

  it("«no hay registros» es una respuesta sin rechazo, pero no confirma la lectura de datos", async () => {
    mocks.withCopecWebServiceSession.mockImplementation(async (run: (session: unknown) => Promise<unknown>) =>
      run({ download: async () => [{ product: "diesel", unavailable: true, reason: "no_results" }] }))
    const result = await actions.testCopecConnectionAction()
    expect(result.ok).toBe(true)
    expect(result.message).toContain("no se pudo confirmar")
  })

  it("traduce cada tipo de falla sin repetir el texto del proveedor", async () => {
    const expectations: Array<[string, RegExp]> = [
      ["provider_rejected", /rechazó la consulta/],
      ["provider_limit", /limitó/],
      ["network", /No fue posible conectar/],
      ["invalid_file", /no se pudo leer/],
    ]
    for (const [kind, pattern] of expectations) {
      mocks.withCopecWebServiceSession.mockImplementationOnce(async (run: (session: unknown) => Promise<unknown>) =>
        run({ download: async () => [{ product: "diesel", unavailable: false, failure: { kind, message: "Copec rechazó la consulta: usuario=jefa clave=***" } }] }))
      const result = await actions.testCopecConnectionAction()
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(pattern)
      expect(result.message).not.toContain("jefa")
    }
  })

  it("una configuración incompleta se explica; cualquier otro error se aplasta", async () => {
    mocks.withCopecWebServiceSession.mockRejectedValueOnce(new Error("Faltan el usuario y la contraseña de Copec para consultar los web services. Ingrésalos en Combustibles › Ajustes › Integraciones."))
    expect(await actions.testCopecConnectionAction()).toMatchObject({ ok: false, message: expect.stringContaining("Faltan el usuario") })

    mocks.withCopecWebServiceSession.mockRejectedValueOnce(new Error("Failed query: select ... params: clave"))
    expect(await actions.testCopecConnectionAction()).toEqual({ ok: false, message: "No fue posible probar la conexión con Copec." })
  })
})
