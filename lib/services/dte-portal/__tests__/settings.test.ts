import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  readStoredDteSettings,
  readStoredDteSettingsStrict,
  saveDtePortalSettings,
  clearStoredDteSettings,
  convertLegacyDteSettings,
  hasStoredDteSettings,
  readDtePortalAdminStatus,
  rotateDteSettingsKeyring,
} from "../settings"
import { recordAudit } from "@/lib/audit"
import { decryptDteSetting, encryptDteSetting, parseDteSettingsKeyring } from "../settings-crypto"

const mocks = vi.hoisted(() => {
  const selectWhere = vi.fn()     // db.select().from().where() → filas dte.*
  const insertValues = vi.fn()    // db.insert().values() → valor a persistir
  const insertDoUpdate = vi.fn()  // db.insert().values().onConflictDoUpdate()
  const deleteWhere = vi.fn()     // db.delete().where()
  const txSelectWhere = vi.fn()
  const txExecute = vi.fn()
  const transaction = vi.fn()
  return { selectWhere, insertValues, insertDoUpdate, deleteWhere, txSelectWhere, txExecute, transaction }
})

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (...args: unknown[]) => {
      const result = mocks.selectWhere(...args)
      return Object.assign(result, { limit: () => result })
    } }) }),
    insert: () => ({ values: (...args: unknown[]) => {
      mocks.insertValues(...args)
      return { onConflictDoUpdate: mocks.insertDoUpdate }
    } }),
    delete: () => ({ where: mocks.deleteWhere }),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

function installTransactionMock() {
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    execute: mocks.txExecute,
    select: () => ({ from: () => ({ where: (...args: unknown[]) => ({ for: () => mocks.txSelectWhere(...args) }) }) }),
    insert: () => ({ values: (...args: unknown[]) => {
      mocks.insertValues(...args)
      return { onConflictDoUpdate: mocks.insertDoUpdate }
    } }),
    delete: () => ({ where: mocks.deleteWhere }),
  }))
}

describe("readStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
  })

  it("returns a partial map of known dte.* keys, ignoring unknown keys", async () => {
    mocks.selectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.clave", value: "secret" },
      { key: "dte.future_unknown_key", value: "x" },
    ])

    await expect(readStoredDteSettings()).resolves.toEqual({
      rutUsr: "11111111-1",
      clave: "secret",
    })
  })

  it("returns {} when nothing is stored", async () => {
    mocks.selectWhere.mockResolvedValue([])
    await expect(readStoredDteSettings()).resolves.toEqual({})
  })

  it("returns {} on DB error so callers fall back to env", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"))
    await expect(readStoredDteSettings()).resolves.toEqual({})
  })

  it("fails closed for a runtime read when PostgreSQL is unavailable", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"))
    await expect(readStoredDteSettingsStrict()).rejects.toMatchObject({
      code: "DTE_SETTINGS_READ_FAILED",
    })
  })
})

describe("hasStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is false when no dte.* keys exist", async () => {
    mocks.selectWhere.mockResolvedValue([])
    await expect(hasStoredDteSettings()).resolves.toBe(false)
  })

  it("is true when at least one dte.* key exists", async () => {
    mocks.selectWhere.mockResolvedValue([{ key: "dte.cod_emp", value: "433" }])
    await expect(hasStoredDteSettings()).resolves.toBe(true)
  })
})

describe("readDtePortalAdminStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns only safe configuration flags, never effective credential values", async () => {
    mocks.selectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.rut_emp", value: "78023530-6" },
      { key: "dte.clave", value: "secret-value" },
      { key: "dte.cod_emp", value: "433" },
      { key: "dte.sync_importer_email", value: "importer@example.test" },
      { key: "dte.sync_enabled", value: "true" },
    ])

    const status = await readDtePortalAdminStatus()
    const serialized = JSON.stringify(status)

    expect(status.configured).toBe(true)
    expect(status.syncEnabled).toBe(true)
    expect(status.fields.clave.configured).toBe(true)
    expect(status.fields.importerEmail.configured).toBe(true)
    expect(serialized).not.toContain("11111111-1")
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("importer@example.test")
  })

  it("does not require the optional importer email to report portal credentials configured", async () => {
    mocks.selectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.rut_emp", value: "78023530-6" },
      { key: "dte.clave", value: "secret-value" },
      { key: "dte.cod_emp", value: "433" },
    ])

    const status = await readDtePortalAdminStatus()

    expect(status.configured).toBe(true)
    expect(status.fields.importerEmail).toEqual({ configured: false, source: "missing" })
  })

  it("keeps the controlled cutover available until its durable marker exists", async () => {
    const originalEnv = process.env
    const activeKey = Buffer.alloc(32, 8).toString("base64url")
    const keyring = parseDteSettingsKeyring({
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "active",
      DTE_SETTINGS_KEYRING: JSON.stringify({ active: activeKey }),
    })
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "active",
      DTE_SETTINGS_KEYRING: JSON.stringify({ active: activeKey }),
    }
    mocks.selectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: encryptDteSetting("11111111-1", "dte.rut_usr", keyring) },
      { key: "dte.rut_emp", value: encryptDteSetting("78023530-6", "dte.rut_emp", keyring) },
      { key: "dte.clave", value: encryptDteSetting("password", "dte.clave", keyring) },
      { key: "dte.cod_emp", value: encryptDteSetting("433", "dte.cod_emp", keyring) },
    ])
    try {
      const status = await readDtePortalAdminStatus()

      expect(status).toMatchObject({
        encryptionMode: "encrypted_only",
        encryptionStatus: "encrypted",
        cutoverComplete: false,
        canMigrateLegacy: true,
      })
    } finally {
      process.env = originalEnv
    }
  })

  it("tells the screen that secrets cannot be stored without an active keyring", async () => {
    const originalEnv = process.env
    process.env = { ...originalEnv, DTE_SETTINGS_MODE: "compat", DTE_SETTINGS_ACTIVE_KEY_ID: "", DTE_SETTINGS_KEYRING: "" }
    mocks.selectWhere.mockResolvedValue([])
    try {
      await expect(readDtePortalAdminStatus()).resolves.toMatchObject({ canStoreSecrets: false })
    } finally {
      process.env = originalEnv
    }
  })

  it("fails closed in the Admin DTO when persistent settings cannot be read", async () => {
    const originalEnv = process.env
    process.env = {
      ...originalEnv,
      DTE_PORTAL_CLAVE: "environment-secret-must-not-be-advertised",
      DTE_SYNC_ENABLED: "true",
    }
    mocks.selectWhere.mockRejectedValue(new Error("database unavailable"))
    try {
      const status = await readDtePortalAdminStatus()

      expect(status).toMatchObject({
        configured: false,
        syncEnabled: false,
        encryptionStatus: "configuration_error",
      })
      expect(JSON.stringify(status)).not.toContain("environment-secret-must-not-be-advertised")
    } finally {
      process.env = originalEnv
    }
  })
})

describe("saveDtePortalSettings", () => {
  const envBeforeSuite = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
    mocks.selectWhere.mockResolvedValue([])
    mocks.txSelectWhere.mockResolvedValue([])
    // Guardar un secreto exige keyring activo (compat sólo sirve para leer
    // filas legacy), así que la suite lo provisiona como en producción.
    process.env = {
      ...envBeforeSuite,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "suite-key",
      DTE_SETTINGS_KEYRING: JSON.stringify({ "suite-key": Buffer.alloc(32, 5).toString("base64url") }),
    }
  })

  afterEach(() => {
    process.env = envBeforeSuite
  })

  it("refuses to persist a secret in plaintext when no keyring is configured", async () => {
    process.env = {
      ...envBeforeSuite,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "",
      DTE_SETTINGS_KEYRING: "",
    }

    await expect(saveDtePortalSettings({ clave: "Portal.2026" }, { userId: "usr-admin" }))
      .rejects.toMatchObject({ code: "DTE_SETTINGS_KEYRING_REQUIRED" })
    expect(mocks.insertValues).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("records the audit entry inside the same transaction as the credential change", async () => {
    await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })

    const [, client] = vi.mocked(recordAudit).mock.calls[0] ?? []
    expect(client).toBeDefined()
  })

  it("writes only the provided fields and records an audit entry", async () => {
    await saveDtePortalSettings(
      { rutUsr: "11111111-1", codEmp: "433", syncEnabled: true, delayMs: 750 },
      { userId: "usr-admin" },
    )

    expect(mocks.insertDoUpdate).toHaveBeenCalledTimes(4)
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "usr-admin",
      action: "update",
      entityType: "dte_portal_settings",
      entityId: "batch",
    }), expect.anything())
  })

  it("preserves an empty sensitive field until an explicit clear is requested", async () => {
    await saveDtePortalSettings({ rutUsr: "" }, { userId: "usr-admin" })
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(mocks.insertDoUpdate).not.toHaveBeenCalled()

    await saveDtePortalSettings({ rutUsr: "", clearRutUsr: true }, { userId: "usr-admin" })
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
  })

  it("an empty clave keeps the stored one unless clearClave is set", async () => {
    await saveDtePortalSettings({ clave: "" }, { userId: "usr-admin" })
    expect(mocks.insertDoUpdate).not.toHaveBeenCalled()
    expect(mocks.deleteWhere).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.selectWhere.mockResolvedValue([])
    await saveDtePortalSettings({ clave: "", clearClave: true }, { userId: "usr-admin" })
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
  })

  it("writes a non-empty clave", async () => {
    await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })
    expect(mocks.insertDoUpdate).toHaveBeenCalledTimes(1)
  })

  it("encrypts every newly stored sensitive value when the app keyring is configured", async () => {
    const originalEnv = process.env
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "test-key",
      DTE_SETTINGS_KEYRING: JSON.stringify({ "test-key": Buffer.alloc(32, 9).toString("base64url") }),
    }
    try {
      await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })
      const stored = mocks.insertValues.mock.calls[0]?.[0] as { key: string; value: string }

      expect(stored.key).toBe("dte.clave")
      expect(stored.value).toMatch(/^enc:v1:test-key:/)
      expect(stored.value).not.toContain("new-pass")
    } finally {
      process.env = originalEnv
    }
  })

  it("validates the delayMs range", async () => {
    await expect(
      saveDtePortalSettings({ delayMs: 99_999 }, { userId: "usr-admin" }),
    ).rejects.toThrow("DTE_SETTINGS_DELAY_INVALID")
  })

  it("never writes the password into the audit log", async () => {
    mocks.txSelectWhere.mockResolvedValueOnce([])

    await saveDtePortalSettings({ clave: "new-pass" }, { userId: "usr-admin" })

    const audit = vi.mocked(recordAudit).mock.calls[0]?.[0]
    expect(JSON.stringify(audit)).not.toContain("new-pass")
    expect(audit).toEqual(expect.objectContaining({
      newState: expect.objectContaining({ claveConfigured: true }),
    }))
  })

  it("does nothing (and does not audit) when no field changes", async () => {
    await saveDtePortalSettings({ clave: "" }, { userId: "usr-admin" })
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("does not let a concurrent Admin save reopen portal I/O during a cutover", async () => {
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.sync_start_barrier", value: "cutover" },
    ])

    await expect(saveDtePortalSettings({ syncEnabled: true }, { userId: "usr-admin" }))
      .rejects.toMatchObject({ code: "DTE_SETTINGS_CUTOVER_IN_PROGRESS" })

    expect(mocks.insertValues).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })
})

describe("clearStoredDteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
    mocks.txSelectWhere.mockResolvedValue([])
  })

  it("deletes all dte.* keys and records the audit entry", async () => {
    mocks.txSelectWhere.mockResolvedValue([{ key: "dte.rut_usr", value: "11111111-1" }])

    await clearStoredDteSettings({ userId: "usr-admin" })

    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      entityType: "dte_portal_settings",
    }), expect.anything())
  })

  it("is a no-op when nothing is stored", async () => {
    mocks.txSelectWhere.mockResolvedValue([])

    await clearStoredDteSettings({ userId: "usr-admin" })

    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("keeps the cutover fence paused when encrypted-only settings are cleared", async () => {
    const originalEnv = process.env
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "active",
      DTE_SETTINGS_KEYRING: JSON.stringify({ active: Buffer.alloc(32, 1).toString("base64url") }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.clave", value: "enc:v1:active:iv:tag:ciphertext" },
      { key: "dte.encryption_mode", value: "encrypted_only" },
      { key: "dte.sync_start_barrier", value: "active" },
    ])
    try {
      await clearStoredDteSettings({ userId: "usr-admin" })
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string; value: string })
      expect(writes).toContainEqual(expect.objectContaining({
        key: "dte.sync_start_barrier",
        value: "paused",
      }))
      expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ newState: { encryptedOnly: true } }), expect.anything())
    } finally {
      process.env = originalEnv
    }
  })
})

describe("controlled encryption conversion and keyring re-cipher", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
    mocks.selectWhere.mockResolvedValue([]) // no active DTE/billing run
  })

  it("pauses sync, locks settings, converts all legacy secrets, and records no plaintext audit", async () => {
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "next",
      DTE_SETTINGS_KEYRING: JSON.stringify({ next: Buffer.alloc(32, 3).toString("base64url") }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.rut_emp", value: "78023530-6" },
      { key: "dte.clave", value: "legacy-password" },
      { key: "dte.cod_emp", value: "433" },
      { key: "dte.sync_importer_email", value: "importer@example.test" },
      { key: "dte.sync_enabled", value: "true" },
    ])
    try {
      await expect(convertLegacyDteSettings({ userId: "admin" })).resolves.toEqual({ converted: 5, keyId: "next" })

      // Pausar nuevos inicios y convertir deben usar el mismo cerrojo. Si el
      // primer write no toma el lock, una corrida puede leer "true" y entrar
      // justo entre la pausa y la espera de corridas activas.
      expect(mocks.txExecute).toHaveBeenCalledTimes(2)
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string; value: string })
      expect(writes.find((value) => value.key === "dte.encryption_mode")?.value).toBe("encrypted_only")
      expect(writes.find((value) => value.key === "dte.sync_enabled")?.value).toBe("false")
      expect(writes.filter((value) => value.key === "dte.sync_start_barrier").map((value) => value.value))
        .toEqual(["cutover", "paused"])
      expect(writes.filter((value) => value.key.startsWith("dte.") && ["dte.rut_usr", "dte.rut_emp", "dte.clave", "dte.cod_emp", "dte.sync_importer_email"].includes(value.key))
        .every((value) => value.value.startsWith("enc:v1:next:"))).toBe(true)
      const keyring = parseDteSettingsKeyring({
        DTE_SETTINGS_MODE: "compat",
        DTE_SETTINGS_ACTIVE_KEY_ID: "next",
        DTE_SETTINGS_KEYRING: JSON.stringify({ next: Buffer.alloc(32, 3).toString("base64url") }),
      })
      const encryptedPassword = writes.find((value) => value.key === "dte.clave")
      expect(encryptedPassword).toBeDefined()
      expect(decryptDteSetting(encryptedPassword!.value, "dte.clave", keyring)).toBe("legacy-password")
      expect(JSON.stringify(vi.mocked(recordAudit).mock.calls[0]?.[0])).not.toContain("legacy-password")
      expect(JSON.stringify(vi.mocked(recordAudit).mock.calls[0]?.[0])).not.toContain("importer@example.test")
    } finally {
      process.env = originalEnv
    }
  })

  it("re-ciphers with a newly active key while retaining the same portal password", async () => {
    const oldKey = Buffer.alloc(32, 1).toString("base64url")
    const nextKey = Buffer.alloc(32, 2).toString("base64url")
    const oldKeyring = parseDteSettingsKeyring({
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "old",
      DTE_SETTINGS_KEYRING: JSON.stringify({ old: oldKey }),
    })
    const oldEnvelope = encryptDteSetting("legacy-password", "dte.clave", oldKeyring)
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "next",
      DTE_SETTINGS_KEYRING: JSON.stringify({ old: oldKey, next: nextKey }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.clave", value: oldEnvelope },
      { key: "dte.encryption_mode", value: "encrypted_only" },
    ])
    try {
      await expect(rotateDteSettingsKeyring({ userId: "admin" })).resolves.toEqual({ rewrapped: 1, keyId: "next" })
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string; value: string })
      expect(writes.find((value) => value.key === "dte.clave")?.value).toMatch(/^enc:v1:next:/)
      const nextKeyring = parseDteSettingsKeyring({
        DTE_SETTINGS_MODE: "encrypted_only",
        DTE_SETTINGS_ACTIVE_KEY_ID: "next",
        DTE_SETTINGS_KEYRING: JSON.stringify({ old: oldKey, next: nextKey }),
      })
      const reencryptedPassword = writes.find((value) => value.key === "dte.clave")
      expect(reencryptedPassword).toBeDefined()
      expect(decryptDteSetting(reencryptedPassword!.value, "dte.clave", nextKeyring)).toBe("legacy-password")
      expect(JSON.stringify(vi.mocked(recordAudit).mock.calls[0]?.[0])).not.toContain("legacy-password")
    } finally {
      process.env = originalEnv
    }
  })

  it("re-wraps the Chipax secrets stored under the same keyring", async () => {
    const oldKey = Buffer.alloc(32, 4).toString("base64url")
    const nextKey = Buffer.alloc(32, 6).toString("base64url")
    const oldKeyring = parseDteSettingsKeyring({
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "old",
      DTE_SETTINGS_KEYRING: JSON.stringify({ old: oldKey }),
    })
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "next",
      DTE_SETTINGS_KEYRING: JSON.stringify({ old: oldKey, next: nextKey }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.clave", value: encryptDteSetting("portal-pass", "dte.clave", oldKeyring) },
      { key: "dte.encryption_mode", value: "encrypted_only" },
      { key: "billing.chipax.secret_key", value: encryptDteSetting("chipax-secret", "billing.chipax.secret_key", oldKeyring) },
    ])
    try {
      await expect(rotateDteSettingsKeyring({ userId: "admin" })).resolves.toEqual({ rewrapped: 2, keyId: "next" })
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string; value: string })
      const chipax = writes.find((value) => value.key === "billing.chipax.secret_key")
      expect(chipax?.value).toMatch(/^enc:v1:next:/)
      const nextKeyring = parseDteSettingsKeyring({
        DTE_SETTINGS_MODE: "encrypted_only",
        DTE_SETTINGS_ACTIVE_KEY_ID: "next",
        DTE_SETTINGS_KEYRING: JSON.stringify({ next: nextKey }),
      })
      expect(decryptDteSetting(chipax!.value, "billing.chipax.secret_key", nextKeyring)).toBe("chipax-secret")
      expect(JSON.stringify(vi.mocked(recordAudit).mock.calls[0]?.[0])).not.toContain("chipax-secret")
    } finally {
      process.env = originalEnv
    }
  })

  it("does not let the host encrypted_only mode bypass the durable conversion marker", async () => {
    const activeKey = Buffer.alloc(32, 7).toString("base64url")
    const keyring = parseDteSettingsKeyring({
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "active",
      DTE_SETTINGS_KEYRING: JSON.stringify({ active: activeKey }),
    })
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "active",
      DTE_SETTINGS_KEYRING: JSON.stringify({ active: activeKey }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: encryptDteSetting("11111111-1", "dte.rut_usr", keyring) },
      { key: "dte.rut_emp", value: encryptDteSetting("78023530-6", "dte.rut_emp", keyring) },
      { key: "dte.clave", value: encryptDteSetting("legacy-password", "dte.clave", keyring) },
      { key: "dte.cod_emp", value: encryptDteSetting("433", "dte.cod_emp", keyring) },
    ])
    try {
      await expect(convertLegacyDteSettings({ userId: "admin" })).resolves.toEqual({ converted: 0, keyId: "active" })
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string; value: string })
      expect(writes).toContainEqual(expect.objectContaining({ key: "dte.encryption_mode", value: "encrypted_only" }))
      expect(JSON.stringify(vi.mocked(recordAudit).mock.calls[0]?.[0])).not.toContain("legacy-password")
    } finally {
      process.env = originalEnv
    }
  })

  it("refuses conversion of a half-persisted legacy setup instead of mixing in env credentials", async () => {
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "next",
      DTE_SETTINGS_KEYRING: JSON.stringify({ next: Buffer.alloc(32, 3).toString("base64url") }),
    }
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.rut_usr", value: "11111111-1" },
      { key: "dte.clave", value: "legacy-password" },
    ])
    try {
      await expect(convertLegacyDteSettings({ userId: "admin" }))
        .rejects.toMatchObject({ code: "DTE_SETTINGS_INCOMPLETE_LEGACY" })
      const writes = mocks.insertValues.mock.calls.map(([value]) => value as { key: string })
      expect(writes.some((value) => value.key === "dte.encryption_mode")).toBe(false)
    } finally {
      process.env = originalEnv
    }
  })

  it("refuses keyring re-cipher until the durable encrypted-only conversion marker exists", async () => {
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "encrypted_only",
      DTE_SETTINGS_ACTIVE_KEY_ID: "next",
      DTE_SETTINGS_KEYRING: JSON.stringify({ next: Buffer.alloc(32, 2).toString("base64url") }),
    }
    mocks.txSelectWhere.mockResolvedValue([])
    try {
      await expect(rotateDteSettingsKeyring({ userId: "admin" }))
        .rejects.toMatchObject({ code: "DTE_SETTINGS_ENCRYPTED_ONLY_REQUIRED" })
    } finally {
      process.env = originalEnv
    }
  })

  it("rechecks the durable cutover barrier under the lock before saving a secret", async () => {
    // Simula un guardado que empezó antes del corte: su primera lectura ve
    // compat, pero al entrar al lock la conversión ya escribió encrypted_only.
    // Debe fallar cerrado sin un keyring activo, nunca volver a texto plano.
    process.env = {
      ...originalEnv,
      DTE_SETTINGS_MODE: "compat",
      DTE_SETTINGS_ACTIVE_KEY_ID: "",
      DTE_SETTINGS_KEYRING: "",
    }
    mocks.selectWhere.mockResolvedValue([])
    mocks.txSelectWhere.mockResolvedValue([
      { key: "dte.encryption_mode", value: "encrypted_only" },
    ])
    try {
      await expect(saveDtePortalSettings({ clave: "should-not-be-plaintext" }, { userId: "admin" }))
        .rejects.toMatchObject({ code: "DTE_SETTINGS_KEYRING_REQUIRED" })
      expect(mocks.txExecute).toHaveBeenCalledTimes(1)
      expect(mocks.insertValues).not.toHaveBeenCalled()
    } finally {
      process.env = originalEnv
    }
  })
})
