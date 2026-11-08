import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computeRutDv } from "@/lib/rut"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  writes: [] as { key: string; value: string }[],
  deletedKeys: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  userLookups: 0,
  activeUser: undefined as { email: string } | undefined,
}))

function selectChain() {
  return { from: () => ({ where: async () => mocks.rows }) }
}

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain(),
    query: {
      users: {
        findFirst: async () => {
          mocks.userLookups++
          return mocks.activeUser
        },
      },
    },
    transaction: async <T,>(callback: (tx: unknown) => Promise<T>) => callback({
      __tx: true,
      select: () => selectChain(),
      insert: () => ({
        values: (value: { key: string; value: string }) => ({
          onConflictDoUpdate: async () => { mocks.writes.push(value) },
        }),
      }),
      delete: () => ({ where: async (condition: unknown) => { mocks.deletedKeys.push(condition) } }),
    }),
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: async (params: Record<string, unknown>) => { mocks.audits.push(params) },
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: () => {}, error: () => {} } }))

const {
  clearCopecSettings,
  copecConfigFromEnv,
  CopecSettingsError,
  loadCopecConfig,
  readCopecAdminStatus,
  saveCopecSettings,
  summarizeCopecStatus,
} = await import("../copec-settings")
const { EncryptedSettingsError } = await import("@/lib/services/encrypted-settings")
const { encryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")
function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}

const actor = { userId: "u1", userEmail: "admin@chome.cl" }
const RUT = `76123456-${computeRutDv("76123456")}`
const ENV = {
  COPEC_USERNAME: "usuario-env",
  COPEC_PASSWORD: "clave-env",
  COPEC_CLIENT_RUT: RUT,
  COPEC_SYNC_IMPORTER_EMAIL: "importador@chome.cl",
}

beforeEach(() => {
  mocks.rows = []
  mocks.writes = []
  mocks.deletedKeys = []
  mocks.audits = []
  mocks.userLookups = 0
  mocks.activeUser = undefined
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("loadCopecConfig", () => {
  it("sin nada guardado rige el .env", async () => {
    const config = await loadCopecConfig(ENV)
    expect(config).toMatchObject({
      username: "usuario-env",
      password: "clave-env",
      clientRut: RUT,
      importerEmail: "importador@chome.cl",
      hasCredentials: true,
      hasUnreadableSecret: false,
    })
  })

  it("lo guardado gana sobre el .env, campo por campo", async () => {
    stubKeyring()
    mocks.rows = [
      { key: "combustibles.copec.password", value: encryptDteSetting("clave-guardada", "combustibles.copec.password") },
      { key: "combustibles.copec.importer_email", value: "otro@chome.cl" },
    ]
    const config = await loadCopecConfig(ENV)
    expect(config.password).toBe("clave-guardada")
    expect(config.importerEmail).toBe("otro@chome.cl")
    // Lo que no se guardó sigue saliendo del servidor.
    expect(config.username).toBe("usuario-env")
    expect(config.clientRut).toBe(RUT)
  })

  it("las credenciales exigen usuario, contraseña y RUT", async () => {
    expect((await loadCopecConfig({ ...ENV, COPEC_CLIENT_RUT: "" })).hasCredentials).toBe(false)
    expect((await loadCopecConfig({ ...ENV, COPEC_PASSWORD: "" })).hasCredentials).toBe(false)
    expect((await loadCopecConfig({})).hasCredentials).toBe(false)
  })

  describe("interruptor de la actualización diaria", () => {
    it("sin nada configurado sigue encendida: no se apaga la integración de nadie por omisión", async () => {
      expect((await loadCopecConfig({})).syncEnabled).toBe(true)
    })

    it("sólo «false» exacto la apaga", async () => {
      expect((await loadCopecConfig({ COPEC_SYNC_ENABLED: "false" })).syncEnabled).toBe(false)
      expect((await loadCopecConfig({ COPEC_SYNC_ENABLED: " false " })).syncEnabled).toBe(false)
      expect((await loadCopecConfig({ COPEC_SYNC_ENABLED: "0" })).syncEnabled).toBe(true)
      expect((await loadCopecConfig({ COPEC_SYNC_ENABLED: "true" })).syncEnabled).toBe(true)
    })

    it("lo guardado gana: un «true» guardado enciende lo que el .env apagaba y al revés", async () => {
      mocks.rows = [{ key: "combustibles.copec.sync_enabled", value: "true" }]
      expect((await loadCopecConfig({ COPEC_SYNC_ENABLED: "false" })).syncEnabled).toBe(true)
      mocks.rows = [{ key: "combustibles.copec.sync_enabled", value: "false" }]
      expect((await loadCopecConfig({})).syncEnabled).toBe(false)
    })
  })

  it("un sobre que el llavero no abre no cae al .env: es la credencial vieja la que la rotación vino a reemplazar", async () => {
    stubKeyring()
    const envelope = encryptDteSetting("clave-guardada", "combustibles.copec.password")
    vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k2: Buffer.alloc(32, 9).toString("base64url") }))
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k2")
    mocks.rows = [{ key: "combustibles.copec.password", value: envelope }]
    const config = await loadCopecConfig(ENV)
    expect(config.password).toBe("")
    expect(config.hasCredentials).toBe(false)
    expect(config.hasUnreadableSecret).toBe(true)
  })
})

describe("copecConfigFromEnv", () => {
  it("lee sólo el entorno, sin BD", () => {
    expect(copecConfigFromEnv(ENV)).toMatchObject({ username: "usuario-env", hasCredentials: true, syncEnabled: true })
    expect(copecConfigFromEnv({ COPEC_SYNC_ENABLED: "false" }).syncEnabled).toBe(false)
  })
})

describe("readCopecAdminStatus", () => {
  it("nunca incluye usuario ni contraseña; el RUT y el correo sí viajan", async () => {
    stubKeyring()
    mocks.rows = [{ key: "combustibles.copec.password", value: encryptDteSetting("clave-guardada", "combustibles.copec.password") }]
    const status = await readCopecAdminStatus(ENV)
    const serialized = JSON.stringify(status)
    for (const secret of ["clave-guardada", "clave-env", "usuario-env"]) expect(serialized).not.toContain(secret)
    expect(status.fields.password).toEqual({ configured: true, source: "system_settings" })
    expect(status.fields.username).toEqual({ configured: true, source: "environment" })
    expect(status.fields.clientRut).toEqual({ configured: true, source: "environment", value: RUT })
    expect(status.fields.importerEmail).toEqual({ configured: true, source: "environment", value: "importador@chome.cl" })
    expect(status.hasStoredSettings).toBe(true)
    expect(status.canStoreSecrets).toBe(true)
  })

  it("sin llavero dice que no se pueden guardar secretos", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    expect((await readCopecAdminStatus(ENV)).canStoreSecrets).toBe(false)
  })

  it("el resumen de la tarjeta coincide con lo que lee el cron", async () => {
    expect(summarizeCopecStatus(await readCopecAdminStatus(ENV))).toEqual({ hasCredentials: true, syncEnabled: true })
    expect(summarizeCopecStatus(await readCopecAdminStatus({ ...ENV, COPEC_CLIENT_RUT: "" }))).toMatchObject({ hasCredentials: false })
    expect(summarizeCopecStatus(await readCopecAdminStatus({ COPEC_SYNC_ENABLED: "false" }))).toMatchObject({ syncEnabled: false })
    // Sin valor en ningún lado rige el default: encendida.
    expect(summarizeCopecStatus(await readCopecAdminStatus({}))).toMatchObject({ syncEnabled: true })
  })
})

describe("saveCopecSettings", () => {
  it("cifra usuario y contraseña, normaliza el RUT y audita sin los secretos", async () => {
    stubKeyring()
    const result = await saveCopecSettings({
      username: "usuario-nuevo",
      password: "clave-nueva",
      clientRut: `76.123.456-${computeRutDv("76123456")}`,
    }, actor, {})
    expect(result.changed).toBe(true)
    expect(mocks.writes.find((w) => w.key === "combustibles.copec.username")!.value.startsWith("enc:v1:k1:")).toBe(true)
    expect(mocks.writes.find((w) => w.key === "combustibles.copec.password")!.value.startsWith("enc:v1:k1:")).toBe(true)
    expect(mocks.writes.find((w) => w.key === "combustibles.copec.client_rut")!.value).toBe(RUT)
    expect(mocks.audits).toHaveLength(1)
    const audit = JSON.stringify(mocks.audits[0])
    expect(audit).not.toContain("usuario-nuevo")
    expect(audit).not.toContain("clave-nueva")
    expect(mocks.audits[0]).toMatchObject({ entityType: "fuel_copec_settings", entityId: "copec" })
  })

  it("rechaza un RUT con el dígito verificador mal antes de tocar la BD", async () => {
    const wrong = computeRutDv("76123456") === "0" ? "1" : "0"
    await expect(saveCopecSettings({ clientRut: `76123456-${wrong}` }, actor, {})).rejects.toMatchObject({
      name: "CopecSettingsError",
      code: "COPEC_RUT_INVALID",
      message: expect.stringContaining("dígito verificador"),
    })
    await expect(saveCopecSettings({ clientRut: "no es un rut" }, actor, {})).rejects.toMatchObject({
      code: "COPEC_RUT_INVALID",
      message: expect.stringContaining("formato"),
    })
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("el usuario de la corrida tiene que ser un usuario activo", async () => {
    mocks.activeUser = undefined
    await expect(saveCopecSettings({ importerEmail: "fantasma@chome.cl" }, actor, {})).rejects.toMatchObject({
      code: "COPEC_IMPORTER_INACTIVE",
    })
    await expect(saveCopecSettings({ importerEmail: "no-es-correo" }, actor, {})).rejects.toBeInstanceOf(CopecSettingsError)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("guarda el correo tal como está en `users`, que es como lo busca la corrida", async () => {
    mocks.activeUser = { email: "Importador@Chome.cl" }
    await saveCopecSettings({ importerEmail: "importador@chome.cl" }, actor, {})
    expect(mocks.writes).toEqual([expect.objectContaining({ key: "combustibles.copec.importer_email", value: "Importador@Chome.cl" })])
  })

  it("abrir y guardar sin cambios no fija en la plataforma lo que viene del .env", async () => {
    const result = await saveCopecSettings({
      clientRut: RUT,
      importerEmail: "IMPORTADOR@chome.cl",
      syncEnabled: true,
    }, actor, ENV)
    expect(result.changed).toBe(false)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
    // Tampoco revalida al usuario si el correo no cambió.
    expect(mocks.userLookups).toBe(0)
  })

  it("el interruptor se guarda sólo cuando difiere de lo vigente", async () => {
    await saveCopecSettings({ syncEnabled: false }, actor, {})
    expect(mocks.writes).toEqual([expect.objectContaining({ key: "combustibles.copec.sync_enabled", value: "false" })])
    expect(mocks.audits[0]).toMatchObject({ oldState: { syncEnabled: null }, newState: { syncEnabled: "false" } })
  })

  it("con un secreto y sin llavero se rechaza entero, sin escrituras ni auditoría", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    await expect(saveCopecSettings({ password: "clave-nueva", syncEnabled: false }, actor, {})).rejects.toMatchObject({
      code: "SETTINGS_KEYRING_REQUIRED",
    })
    await expect(saveCopecSettings({ password: "clave-nueva" }, actor, {})).rejects.toBeInstanceOf(EncryptedSettingsError)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("sin llavero sí se guardan los valores que no son secretos", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    const result = await saveCopecSettings({ clientRut: RUT, syncEnabled: false }, actor, {})
    expect(result.changed).toBe(true)
    expect(mocks.writes.map((w) => w.key).sort()).toEqual(["combustibles.copec.client_rut", "combustibles.copec.sync_enabled"])
  })

  it("«Borrar» devuelve el campo al .env y se audita como borrado sin el valor", async () => {
    stubKeyring()
    mocks.rows = [{ key: "combustibles.copec.password", value: encryptDteSetting("clave-guardada", "combustibles.copec.password") }]
    const result = await saveCopecSettings({ clearPassword: true }, actor, ENV)
    expect(result).toMatchObject({ changed: true, cleared: ["password"] })
    expect(mocks.deletedKeys).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ newState: { passwordCleared: true } })
    expect(JSON.stringify(mocks.audits[0])).not.toContain("clave-guardada")
  })
})

describe("clearCopecSettings", () => {
  it("con algo guardado lo borra y audita; sin nada guardado no hace nada", async () => {
    expect(await clearCopecSettings(actor)).toEqual({ changed: false })
    expect(mocks.audits).toEqual([])

    mocks.rows = [{ key: "combustibles.copec.sync_enabled", value: "false" }]
    expect(await clearCopecSettings(actor)).toEqual({ changed: true })
    expect(mocks.audits[0]).toMatchObject({ action: "delete", entityType: "fuel_copec_settings", newState: { cleared: ["syncEnabled"] } })
  })
})
