import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  writes: [] as { key: string; value: string }[],
  deletes: 0,
  audits: [] as Record<string, unknown>[],
  /** True si la auditoría viajó con la transacción y no con `db` a secas. */
  auditsInTx: [] as boolean[],
}))

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => mocks.rows }) }),
    transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      __tx: true,
      insert: () => ({
        values: (value: { key: string; value: string }) => ({
          onConflictDoUpdate: async () => { mocks.writes.push(value) },
        }),
      }),
      delete: () => ({ where: async () => { mocks.deletes += 1 } }),
    }),
    delete: () => ({ where: async () => { mocks.deletes += 1 } }),
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: async (params: Record<string, unknown>, client?: { __tx?: boolean }) => {
    mocks.audits.push(params)
    mocks.auditsInTx.push(Boolean(client?.__tx))
  },
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: () => {}, error: () => {} } }))

const {
  CHIPAX_SETTING_KEYS,
  ChipaxSettingsError,
  readChipaxAdminStatus,
  readChipaxConfig,
  clearChipaxSettings,
  saveChipaxSettings,
} = await import("../chipax-settings")
const { encryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

/** Keyring de prueba: 32 bytes, el largo que exige AES-256. */
const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")

function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}

function stubEnvCredentials() {
  vi.stubEnv("BILLING_CHIPAX_ENABLED", "true")
  vi.stubEnv("BILLING_CHIPAX_SYNC_ENABLED", "false")
  vi.stubEnv("CHIPAX_APP_ID", "app-del-entorno")
  vi.stubEnv("CHIPAX_SECRET_KEY", "secreto-del-entorno")
}

beforeEach(() => {
  mocks.rows = []
  mocks.writes = []
  mocks.deletes = 0
  mocks.audits = []
  mocks.auditsInTx = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("readChipaxConfig", () => {
  it("sin nada persistido devuelve exactamente el entorno", async () => {
    stubEnvCredentials()

    const config = await readChipaxConfig()

    expect(config.enabled).toBe(true)
    expect(config.syncEnabled).toBe(false)
    expect(config.appId).toBe("app-del-entorno")
    expect(config.secretKey).toBe("secreto-del-entorno")
    expect(config.hasCredentials).toBe(true)
  })

  it("lo guardado en la plataforma gana sobre el entorno", async () => {
    stubEnvCredentials()
    stubKeyring()
    mocks.rows = [
      { key: CHIPAX_SETTING_KEYS.appId, value: encryptDteSetting("app-guardada", CHIPAX_SETTING_KEYS.appId) },
      { key: CHIPAX_SETTING_KEYS.secretKey, value: encryptDteSetting("secreto-guardado", CHIPAX_SETTING_KEYS.secretKey) },
      { key: CHIPAX_SETTING_KEYS.syncEnabled, value: "true" },
    ]

    const config = await readChipaxConfig()

    expect(config.appId).toBe("app-guardada")
    expect(config.secretKey).toBe("secreto-guardado")
    // El flag sin fila persistida sigue viniendo del entorno.
    expect(config.enabled).toBe(true)
    expect(config.syncEnabled).toBe(true)
  })

  it("un flag persistido en false apaga lo que el entorno enciende", async () => {
    stubEnvCredentials()
    mocks.rows = [{ key: CHIPAX_SETTING_KEYS.enabled, value: "false" }]

    expect((await readChipaxConfig()).enabled).toBe(false)
  })

  it("ignora un secreto persistido sin cifrar en vez de usarlo", async () => {
    stubEnvCredentials()
    stubKeyring()
    // Sólo puede llegar acá por un INSERT a mano en la tabla.
    mocks.rows = [{ key: CHIPAX_SETTING_KEYS.secretKey, value: "secreto-en-claro" }]

    const config = await readChipaxConfig()

    expect(config.secretKey).toBe("secreto-del-entorno")
    expect(config.secretKey).not.toBe("secreto-en-claro")
  })

  it("un sobre cifrado que no se puede abrir NO cae a la credencial del entorno", async () => {
    stubEnvCredentials()
    stubKeyring()
    const guardada = encryptDteSetting("secreto-guardado", CHIPAX_SETTING_KEYS.secretKey)
    // Réplica desplegada sin el keyring (o con otro): el sobre existe y es el
    // vigente, así que usar el del `.env` significa operar con la credencial que
    // la rotación vino a reemplazar, y de forma intermitente entre réplicas.
    vi.unstubAllEnvs()
    stubEnvCredentials()
    mocks.rows = [{ key: CHIPAX_SETTING_KEYS.secretKey, value: guardada }]

    const config = await readChipaxConfig()

    expect(config.secretKey).toBe("")
    expect(config.secretKey).not.toBe("secreto-del-entorno")
    expect(config.hasCredentials).toBe(false)

    const status = await readChipaxAdminStatus()
    expect(status.fields.secretKey).toEqual({ configured: false, source: "missing" })
  })

  it("una caída de la base de datos cae al entorno, no deja a Chipax sin credenciales", async () => {
    stubEnvCredentials()
    mocks.rows = { get length() { throw new Error("db caída") } } as unknown as typeof mocks.rows

    const config = await readChipaxConfig()

    expect(config.hasCredentials).toBe(true)
    expect(config.appId).toBe("app-del-entorno")
  })
})

describe("readChipaxAdminStatus", () => {
  it("informa el origen de cada campo sin exponer un solo valor", async () => {
    stubEnvCredentials()
    stubKeyring()
    mocks.rows = [
      { key: CHIPAX_SETTING_KEYS.appId, value: encryptDteSetting("app-guardada", CHIPAX_SETTING_KEYS.appId) },
    ]

    const status = await readChipaxAdminStatus()

    expect(status.fields.appId).toEqual({ configured: true, source: "system_settings" })
    expect(status.fields.secretKey).toEqual({ configured: true, source: "environment" })
    expect(status.canStoreSecrets).toBe(true)
    expect(JSON.stringify(status)).not.toMatch(/app-guardada|secreto-del-entorno/)
  })

  it("sin keyring avisa que no se pueden guardar credenciales", async () => {
    stubEnvCredentials()

    expect((await readChipaxAdminStatus()).canStoreSecrets).toBe(false)
  })
})

describe("saveChipaxSettings", () => {
  const actor = { userId: "u-1", userEmail: "quien@empresa.cl" }

  it("cifra los secretos y audita el cambio sin registrar su valor", async () => {
    stubKeyring()

    await saveChipaxSettings({ appId: "app-nueva", secretKey: "secreto-nuevo", enabled: true, syncEnabled: true }, actor)

    const secret = mocks.writes.find((write) => write.key === CHIPAX_SETTING_KEYS.secretKey)
    expect(secret?.value).toMatch(/^enc:v1:k1:/)
    expect(secret?.value).not.toContain("secreto-nuevo")
    expect(JSON.stringify(mocks.audits)).not.toMatch(/app-nueva|secreto-nuevo/)
    expect(mocks.audits[0]).toMatchObject({ entityType: "billing_chipax_settings", newState: { secretKeyUpdated: true } })
  })

  it("un secreto vacío conserva el que ya estaba", async () => {
    stubKeyring()

    await saveChipaxSettings({ appId: "", secretKey: "  ", enabled: true, syncEnabled: false }, actor)

    expect(mocks.writes.map((write) => write.key)).toEqual([
      CHIPAX_SETTING_KEYS.enabled,
      CHIPAX_SETTING_KEYS.syncEnabled,
    ])
  })

  it("sin keyring se niega a guardar credenciales en vez de dejarlas en claro", async () => {
    await expect(
      saveChipaxSettings({ secretKey: "secreto-nuevo", enabled: true, syncEnabled: true }, actor),
    ).rejects.toBeInstanceOf(ChipaxSettingsError)

    expect(mocks.writes).toHaveLength(0)
    expect(mocks.audits).toHaveLength(0)
  })

  // Si la auditoría queda fuera de la transacción, un fallo del commit deja el
  // secreto cambiado sin registro de quién lo cambió.
  it("audita dentro de la misma transacción que escribe el secreto", async () => {
    stubKeyring()

    await saveChipaxSettings({ secretKey: "secreto-nuevo", enabled: true, syncEnabled: true }, actor)

    expect(mocks.auditsInTx).toEqual([true])
  })
})

describe("clearChipaxSettings", () => {
  it("borra y audita dentro de la misma transacción", async () => {
    await clearChipaxSettings({ userId: "u-1", userEmail: "quien@empresa.cl" })

    expect(mocks.deletes).toBe(1)
    expect(mocks.audits[0]).toMatchObject({ action: "delete", entityType: "billing_chipax_settings" })
    expect(mocks.auditsInTx).toEqual([true])
  })
})
