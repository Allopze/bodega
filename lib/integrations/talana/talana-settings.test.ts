import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Token y modo de Talana: lo guardado gana, el `.env` es el respaldo, un modo
 * guardado inválido apaga, y lo que sale hacia la pantalla nunca lleva el token.
 * La semántica del helper está probada en `encrypted-settings.test.ts`; acá se
 * prueba lo propio de Talana sobre el mismo doble de la BD.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  failRead: false,
  writes: [] as { key: string; value: string }[],
  deletedKeys: [] as unknown[],
  audits: [] as Record<string, unknown>[],
}))

function selectChain() {
  return {
    from: () => ({
      where: async () => {
        if (mocks.failRead) throw new Error("db down")
        return mocks.rows
      },
    }),
  }
}

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain(),
    transaction: async <T,>(callback: (tx: unknown) => Promise<T>) => callback({
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
  clearTalanaSettings,
  loadTalanaConfig,
  normalizeTalanaMode,
  readTalanaAdminStatus,
  readTalanaConfig,
  saveTalanaSettings,
} = await import("./talana-settings")
const { encryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")
const FAKE_ENV_TOKEN = "token-del-entorno-falso"
const FAKE_STORED_TOKEN = "token-guardado-falso"
const ENV = { TALANA_API_TOKEN: FAKE_ENV_TOKEN, TALANA_SYNC_MODE: "simulate" } as unknown as NodeJS.ProcessEnv
const EMPTY_ENV = {} as NodeJS.ProcessEnv
const actor = { userId: "admin-1", userEmail: "admin@chome.cl" }

function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}
function stubNoKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", "")
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
}
const storedToken = (value = FAKE_STORED_TOKEN) => ({ key: "talana.api_token", value: encryptDteSetting(value, "talana.api_token") })

beforeEach(() => {
  mocks.rows = []
  mocks.failRead = false
  mocks.writes = []
  mocks.deletedKeys = []
  mocks.audits = []
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("readTalanaConfig (sólo entorno)", () => {
  it("conserva la regla de siempre: sólo simulate y apply encienden, cualquier otra cosa apaga", () => {
    expect(readTalanaConfig(ENV)).toEqual({ token: FAKE_ENV_TOKEN, mode: "simulate", hasCredentials: true, enabled: true })
    expect(readTalanaConfig({ TALANA_API_TOKEN: " t ", TALANA_SYNC_MODE: " apply " } as unknown as NodeJS.ProcessEnv))
      .toEqual({ token: "t", mode: "apply", hasCredentials: true, enabled: true })
    expect(readTalanaConfig({ TALANA_API_TOKEN: "t", TALANA_SYNC_MODE: "APPLY" } as unknown as NodeJS.ProcessEnv).mode).toBe("off")
    expect(readTalanaConfig(EMPTY_ENV)).toEqual({ token: "", mode: "off", hasCredentials: false, enabled: false })
  })

  it("normalizeTalanaMode apaga lo que no sea exactamente simulate o apply", () => {
    expect(normalizeTalanaMode("simulate")).toBe("simulate")
    expect(normalizeTalanaMode("apply")).toBe("apply")
    for (const raw of ["off", "", "true", "Apply", "aplicar", undefined, null]) {
      expect(normalizeTalanaMode(raw as string | undefined)).toBe("off")
    }
  })
})

describe("loadTalanaConfig", () => {
  it("sin nada guardado es exactamente el entorno de antes, con su origen", async () => {
    const config = await loadTalanaConfig(ENV)
    expect(config).toEqual({
      token: FAKE_ENV_TOKEN,
      mode: "simulate",
      hasCredentials: true,
      enabled: true,
      sources: { token: "environment", mode: "environment" },
      tokenUnreadable: false,
    })
    // Misma forma que el lector de entorno: sólo se le suman `sources` y `tokenUnreadable`.
    expect(config).toMatchObject(readTalanaConfig(ENV))
  })

  it("lo guardado en la plataforma gana sobre el entorno", async () => {
    stubKeyring()
    mocks.rows = [storedToken(), { key: "talana.sync_mode", value: "apply" }]
    const config = await loadTalanaConfig(ENV)
    expect(config.token).toBe(FAKE_STORED_TOKEN)
    expect(config.mode).toBe("apply")
    expect(config.sources).toEqual({ token: "system_settings", mode: "system_settings" })
    expect(config.enabled).toBe(true)
  })

  it("cada campo se resuelve por separado: modo guardado y token del entorno", async () => {
    mocks.rows = [{ key: "talana.sync_mode", value: "off" }]
    const config = await loadTalanaConfig(ENV)
    expect(config).toMatchObject({
      token: FAKE_ENV_TOKEN,
      mode: "off",
      hasCredentials: true,
      enabled: false,
      sources: { token: "environment", mode: "system_settings" },
    })
  })

  it("un modo guardado que no es exactamente simulate/apply apaga, aunque el entorno diga simulate", async () => {
    for (const stored of ["Apply", "aplicar", "true", "cualquier-cosa"]) {
      mocks.rows = [{ key: "talana.sync_mode", value: stored }]
      const config = await loadTalanaConfig(ENV)
      expect(config.mode, `modo guardado «${stored}»`).toBe("off")
      expect(config.enabled).toBe(false)
      expect(config.sources.mode).toBe("system_settings")
    }
  })

  it("si la BD no responde sigue con el entorno", async () => {
    mocks.failRead = true
    const config = await loadTalanaConfig(ENV)
    expect(config).toMatchObject({ token: FAKE_ENV_TOKEN, mode: "simulate", enabled: true })
    expect(config.sources).toEqual({ token: "environment", mode: "environment" })
  })

  it("un token guardado que no se puede abrir NO cae al token del entorno: queda sin token y marcado", async () => {
    stubKeyring()
    const envelope = encryptDteSetting(FAKE_STORED_TOKEN, "talana.api_token")
    vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k2: Buffer.alloc(32, 9).toString("base64url") }))
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k2")
    mocks.rows = [{ key: "talana.api_token", value: envelope }]
    const config = await loadTalanaConfig(ENV)
    expect(config).toMatchObject({ token: "", hasCredentials: false, enabled: false, tokenUnreadable: true })
    expect(config.sources.token).toBe("missing")
  })

  it("un token guardado sin cifrar (escritura a mano) se ignora y se usa el entorno", async () => {
    mocks.rows = [{ key: "talana.api_token", value: "en-claro" }]
    const config = await loadTalanaConfig(ENV)
    expect(config.token).toBe(FAKE_ENV_TOKEN)
    expect(config.sources.token).toBe("environment")
  })

  it("sin token en ningún lado no hay credenciales", async () => {
    const config = await loadTalanaConfig(EMPTY_ENV)
    expect(config).toMatchObject({ token: "", mode: "off", hasCredentials: false, enabled: false })
    expect(config.sources).toEqual({ token: "missing", mode: "missing" })
  })
})

describe("readTalanaAdminStatus", () => {
  it("dice si hay token y de dónde viene, pero nunca incluye su valor (guardado ni del entorno)", async () => {
    stubKeyring()
    mocks.rows = [storedToken(), { key: "talana.sync_mode", value: "apply" }]
    const status = await readTalanaAdminStatus(ENV)
    expect(status).toEqual({
      token: { configured: true, source: "system_settings" },
      mode: "apply",
      modeSource: "system_settings",
      hasStoredSettings: true,
      canStoreSecrets: true,
    })
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain(FAKE_STORED_TOKEN)
    expect(serialized).not.toContain(FAKE_ENV_TOKEN)
  })

  it("con sólo el entorno, el token se informa como del servidor y el estado no trae el valor", async () => {
    stubKeyring()
    const status = await readTalanaAdminStatus(ENV)
    expect(status.token).toEqual({ configured: true, source: "environment" })
    expect(status).toMatchObject({ mode: "simulate", modeSource: "environment", hasStoredSettings: false })
    expect(JSON.stringify(status)).not.toContain(FAKE_ENV_TOKEN)
  })

  it("sin modo configurado en ningún lado la sincronización figura apagada y «sin configurar»", async () => {
    const status = await readTalanaAdminStatus(EMPTY_ENV)
    expect(status).toMatchObject({ token: { configured: false, source: "missing" }, mode: "off", modeSource: "missing" })
  })

  it("un modo guardado inválido se muestra como apagado", async () => {
    mocks.rows = [{ key: "talana.sync_mode", value: "cualquier-cosa" }]
    const status = await readTalanaAdminStatus(ENV)
    expect(status.mode).toBe("off")
    expect(status.modeSource).toBe("system_settings")
  })

  it("sin llavero avisa que no se pueden guardar secretos", async () => {
    stubNoKeyring()
    expect((await readTalanaAdminStatus(ENV)).canStoreSecrets).toBe(false)
  })
})

describe("saveTalanaSettings", () => {
  it("guarda token cifrado y modo, y audita modo anterior y nuevo sin el valor del token", async () => {
    stubKeyring()
    mocks.rows = [{ key: "talana.sync_mode", value: "simulate" }]
    const result = await saveTalanaSettings({ apiToken: "token-nuevo-falso", mode: "apply" }, actor)
    expect(result).toEqual({ changed: true, updated: ["apiToken", "mode"], cleared: [] })
    expect(mocks.writes.find((write) => write.key === "talana.api_token")!.value.startsWith("enc:v1:k1:")).toBe(true)
    expect(mocks.writes.find((write) => write.key === "talana.sync_mode")!.value).toBe("apply")
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      action: "update",
      entityType: "talana_settings",
      entityId: "talana",
      oldState: { mode: "simulate" },
      newState: { apiTokenUpdated: true, mode: "apply" },
    })
    expect(JSON.stringify(mocks.audits[0])).not.toContain("token-nuevo-falso")
  })

  it("sin llavero rechaza el token y no escribe nada, ni el modo ni la auditoría", async () => {
    stubNoKeyring()
    await expect(saveTalanaSettings({ apiToken: "token-nuevo-falso", mode: "apply" }, actor))
      .rejects.toMatchObject({ code: "SETTINGS_KEYRING_REQUIRED" })
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("sin llavero el modo sí se guarda", async () => {
    stubNoKeyring()
    const result = await saveTalanaSettings({ mode: "off" }, actor)
    expect(result.changed).toBe(true)
    expect(mocks.writes).toEqual([{ key: "talana.sync_mode", value: "off", updatedAt: expect.any(String) }])
  })

  it("sin modo ni token no escribe: no copia el modo del entorno a la plataforma", async () => {
    stubKeyring()
    const result = await saveTalanaSettings({ apiToken: "", mode: undefined }, actor)
    expect(result.changed).toBe(false)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("borrar el token guardado lo audita como borrado", async () => {
    stubKeyring()
    mocks.rows = [storedToken()]
    const result = await saveTalanaSettings({ clearApiToken: true }, actor)
    expect(result).toEqual({ changed: true, updated: [], cleared: ["apiToken"] })
    expect(mocks.audits[0]).toMatchObject({ newState: { apiTokenCleared: true } })
  })

  it("escribir y borrar el token a la vez se rechaza", async () => {
    stubKeyring()
    await expect(saveTalanaSettings({ apiToken: "x", clearApiToken: true }, actor))
      .rejects.toMatchObject({ code: "SETTINGS_FIELD_CONFLICT" })
    expect(mocks.writes).toEqual([])
  })
})

describe("clearTalanaSettings", () => {
  it("borra lo guardado y devuelve el mando al entorno", async () => {
    mocks.rows = [{ key: "talana.sync_mode", value: "apply" }]
    const result = await clearTalanaSettings(actor)
    expect(result).toEqual({ changed: true })
    expect(mocks.audits[0]).toMatchObject({ action: "delete", entityType: "talana_settings", newState: { cleared: ["mode"] } })
  })
})
