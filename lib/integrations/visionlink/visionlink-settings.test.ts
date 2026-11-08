import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  writes: [] as { key: string; value: string }[],
  deletedKeys: [] as unknown[],
  audits: [] as Record<string, unknown>[],
}))

function selectChain() {
  return { from: () => ({ where: async () => mocks.rows }) }
}

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain(),
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
  clearVisionLinkSettings,
  loadVisionLinkConfig,
  readVisionLinkAdminStatus,
  readVisionLinkConfig,
  saveVisionLinkSettings,
  summarizeVisionLinkStatus,
} = await import("./visionlink-settings")
const { encryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")
function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}

const actor = { userId: "u1", userEmail: "admin@chome.cl" }
const ENV = {
  VISIONLINK_CLIENT_ID: "id-env",
  VISIONLINK_CLIENT_SECRET: "secreto-env",
  VISIONLINK_SCOPE: "scope-env",
  VISIONLINK_SYNC_ENABLED: "true",
}

beforeEach(() => {
  mocks.rows = []
  mocks.writes = []
  mocks.deletedKeys = []
  mocks.audits = []
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("readVisionLinkConfig (el .env, síncrono)", () => {
  it("conserva la regla de siempre: el cron sólo se enciende con «true» exacto", () => {
    expect(readVisionLinkConfig({ ...ENV })).toEqual({
      clientId: "id-env",
      clientSecret: "secreto-env",
      scope: "scope-env",
      syncEnabled: true,
      hasCredentials: true,
    })
    for (const value of ["TRUE", "1", "yes", "", undefined]) {
      expect(readVisionLinkConfig({ ...ENV, VISIONLINK_SYNC_ENABLED: value }).syncEnabled).toBe(false)
    }
  })

  it("sin id o sin secreto no hay credenciales", () => {
    expect(readVisionLinkConfig({ ...ENV, VISIONLINK_CLIENT_SECRET: " " }).hasCredentials).toBe(false)
    expect(readVisionLinkConfig({}).hasCredentials).toBe(false)
  })
})

describe("loadVisionLinkConfig", () => {
  it("sin nada guardado devuelve exactamente lo que daba el .env", async () => {
    expect(await loadVisionLinkConfig(ENV)).toEqual(readVisionLinkConfig(ENV))
    expect(await loadVisionLinkConfig({})).toEqual(readVisionLinkConfig({}))
  })

  it("lo guardado gana sobre el .env, campo por campo", async () => {
    stubKeyring()
    mocks.rows = [
      { key: "combustibles.visionlink.client_secret", value: encryptDteSetting("secreto-guardado", "combustibles.visionlink.client_secret") },
      { key: "combustibles.visionlink.sync_enabled", value: "false" },
    ]
    expect(await loadVisionLinkConfig(ENV)).toEqual({
      clientId: "id-env",
      clientSecret: "secreto-guardado",
      scope: "scope-env",
      syncEnabled: false,
      hasCredentials: true,
    })
  })

  it("un «true» guardado enciende lo que el .env dejaba apagado", async () => {
    mocks.rows = [{ key: "combustibles.visionlink.sync_enabled", value: "true" }]
    expect((await loadVisionLinkConfig({})).syncEnabled).toBe(true)
  })

  it("un secreto que el llavero no abre queda vacío y NO cae al .env", async () => {
    stubKeyring()
    const envelope = encryptDteSetting("secreto-guardado", "combustibles.visionlink.client_secret")
    vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k2: Buffer.alloc(32, 9).toString("base64url") }))
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k2")
    mocks.rows = [{ key: "combustibles.visionlink.client_secret", value: envelope }]
    const config = await loadVisionLinkConfig(ENV)
    expect(config.clientSecret).toBe("")
    expect(config.hasCredentials).toBe(false)
  })
})

describe("readVisionLinkAdminStatus", () => {
  it("nunca incluye el client secret; el client id y el scope sí viajan", async () => {
    stubKeyring()
    mocks.rows = [{ key: "combustibles.visionlink.client_secret", value: encryptDteSetting("secreto-guardado", "combustibles.visionlink.client_secret") }]
    const status = await readVisionLinkAdminStatus(ENV)
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("secreto-guardado")
    expect(serialized).not.toContain("secreto-env")
    expect(status.fields.clientSecret).toEqual({ configured: true, source: "system_settings" })
    expect(status.fields.clientId).toEqual({ configured: true, source: "environment", value: "id-env" })
    expect(status.fields.scope).toEqual({ configured: true, source: "environment", value: "scope-env" })
    expect(status.hasStoredSettings).toBe(true)
    expect(status.canStoreSecrets).toBe(true)
  })

  it("el resumen de la tarjeta coincide con lo que lee el cron", async () => {
    expect(summarizeVisionLinkStatus(await readVisionLinkAdminStatus(ENV))).toEqual({ hasCredentials: true, syncEnabled: true })
    expect(summarizeVisionLinkStatus(await readVisionLinkAdminStatus({}))).toEqual({ hasCredentials: false, syncEnabled: false })
    expect(summarizeVisionLinkStatus(await readVisionLinkAdminStatus({ ...ENV, VISIONLINK_SYNC_ENABLED: "false" }))).toMatchObject({ syncEnabled: false })
  })
})

describe("saveVisionLinkSettings", () => {
  it("cifra el secreto y audita sin su valor", async () => {
    stubKeyring()
    const result = await saveVisionLinkSettings({ clientId: "id-nuevo", clientSecret: "secreto-nuevo", syncEnabled: true }, actor, {})
    expect(result.changed).toBe(true)
    expect(mocks.writes.find((w) => w.key === "combustibles.visionlink.client_secret")!.value.startsWith("enc:v1:k1:")).toBe(true)
    expect(mocks.writes.find((w) => w.key === "combustibles.visionlink.client_id")!.value).toBe("id-nuevo")
    expect(JSON.stringify(mocks.audits[0])).not.toContain("secreto-nuevo")
    expect(mocks.audits[0]).toMatchObject({ entityType: "fuel_visionlink_settings", entityId: "visionlink" })
  })

  it("abrir y guardar sin cambios no fija en la plataforma lo que viene del .env", async () => {
    const result = await saveVisionLinkSettings({
      clientId: "id-env",
      scope: "scope-env",
      syncEnabled: true,
    }, actor, ENV)
    expect(result.changed).toBe(false)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("el interruptor se guarda como «true» o «false» sólo cuando cambia", async () => {
    await saveVisionLinkSettings({ syncEnabled: false }, actor, ENV)
    expect(mocks.writes).toEqual([expect.objectContaining({ key: "combustibles.visionlink.sync_enabled", value: "false" })])
  })

  it("con un secreto y sin llavero se rechaza entero, sin escrituras ni auditoría", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    await expect(saveVisionLinkSettings({ clientSecret: "secreto-nuevo", syncEnabled: true }, actor, {})).rejects.toMatchObject({
      code: "SETTINGS_KEYRING_REQUIRED",
    })
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("«Borrar» el secreto lo devuelve al .env", async () => {
    stubKeyring()
    mocks.rows = [{ key: "combustibles.visionlink.client_secret", value: encryptDteSetting("secreto-guardado", "combustibles.visionlink.client_secret") }]
    const result = await saveVisionLinkSettings({ clearClientSecret: true }, actor, ENV)
    expect(result).toMatchObject({ changed: true, cleared: ["clientSecret"] })
    expect(mocks.audits[0]).toMatchObject({ newState: { clientSecretCleared: true } })
  })
})

describe("clearVisionLinkSettings", () => {
  it("borra lo guardado y audita; sin nada guardado no hace nada", async () => {
    expect(await clearVisionLinkSettings(actor)).toEqual({ changed: false })
    mocks.rows = [{ key: "combustibles.visionlink.scope", value: "otro" }]
    expect(await clearVisionLinkSettings(actor)).toEqual({ changed: true })
    expect(mocks.audits[0]).toMatchObject({ action: "delete", entityType: "fuel_visionlink_settings" })
  })
})
