import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  failRead: false,
  writes: [] as { key: string; value: string }[],
  deletedKeys: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  auditsInTx: [] as boolean[],
  warnings: [] as string[],
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
  recordAudit: async (params: Record<string, unknown>, client?: { __tx?: boolean }) => {
    mocks.audits.push(params)
    mocks.auditsInTx.push(Boolean(client?.__tx))
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { warn: (message: string) => { mocks.warnings.push(message) }, error: () => {} },
}))

const {
  defineSettingsGroup,
  readSettingsGroup,
  readSettingsAdminStatus,
  saveSettingsGroup,
  clearSettingsGroup,
  canStoreSettingsSecrets,
  EncryptedSettingsError,
} = await import("../encrypted-settings")
const { encryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")
function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}

// Grupo de prueba con una key secreta registrada (la de Talana) y un modo.
const group = defineSettingsGroup({
  name: "prueba",
  entityType: "test_settings",
  entityId: "test",
  fields: {
    token: { key: "talana.api_token", secret: true },
    mode: { key: "talana.sync_mode", secret: false },
  },
})
const ENV = { token: "token-del-entorno", mode: "simulate" }
const actor = { userId: "u1", userEmail: "admin@chome.cl" }

beforeEach(() => {
  mocks.rows = []
  mocks.failRead = false
  mocks.writes = []
  mocks.deletedKeys = []
  mocks.audits = []
  mocks.auditsInTx = []
  mocks.warnings = []
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("defineSettingsGroup", () => {
  it("se niega a definir un secreto que la rotación del llavero no cubre", () => {
    expect(() => defineSettingsGroup({
      name: "huerfano",
      entityType: "x",
      entityId: "x",
      fields: { secreto: { key: "algo.no_registrado", secret: true } },
    })).toThrow(/no está en SHARED_KEYRING_SECRET_KEYS/)
  })

  it("acepta campos no secretos con cualquier key", () => {
    expect(() => defineSettingsGroup({
      name: "libre",
      entityType: "x",
      entityId: "x",
      fields: { flag: { key: "algo.flag", secret: false } },
    })).not.toThrow()
  })
})

describe("readSettingsGroup", () => {
  it("sin nada persistido devuelve el entorno", async () => {
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values).toEqual(ENV)
    expect(resolved.sources).toEqual({ token: "environment", mode: "environment" })
  })

  it("lo guardado gana sobre el entorno", async () => {
    stubKeyring()
    mocks.rows = [
      { key: "talana.api_token", value: encryptDteSetting("token-guardado", "talana.api_token") },
      { key: "talana.sync_mode", value: "apply" },
    ]
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values).toEqual({ token: "token-guardado", mode: "apply" })
    expect(resolved.sources).toEqual({ token: "system_settings", mode: "system_settings" })
  })

  it("ignora un secreto guardado en claro y cae al entorno", async () => {
    mocks.rows = [{ key: "talana.api_token", value: "en-claro" }]
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values.token).toBe("token-del-entorno")
    expect(mocks.warnings.some((w) => w.includes("sin cifrar"))).toBe(true)
  })

  it("un sobre ilegible NO cae al entorno: queda vacío y marcado", async () => {
    stubKeyring()
    const envelope = encryptDteSetting("token-guardado", "talana.api_token")
    vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k2: Buffer.alloc(32, 9).toString("base64url") }))
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k2")
    mocks.rows = [{ key: "talana.api_token", value: envelope }]
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values.token).toBe("")
    expect(resolved.sources.token).toBe("missing")
    expect(resolved.unreadable).toEqual(["token"])
  })

  it("si la BD no responde usa el entorno y lo deja en el log", async () => {
    mocks.failRead = true
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values).toEqual(ENV)
    expect(mocks.warnings.some((w) => w.includes("no se pudieron leer"))).toBe(true)
  })

  it("un campo sin valor en ningún lado queda como missing", async () => {
    const resolved = await readSettingsGroup(group, {})
    expect(resolved.values).toEqual({ token: "", mode: "" })
    expect(resolved.sources).toEqual({ token: "missing", mode: "missing" })
  })
})

describe("readSettingsAdminStatus", () => {
  it("nunca incluye el valor de un secreto, sí el de un campo no secreto", async () => {
    stubKeyring()
    mocks.rows = [{ key: "talana.api_token", value: encryptDteSetting("token-guardado", "talana.api_token") }]
    const status = await readSettingsAdminStatus(group, ENV)
    expect(JSON.stringify(status)).not.toContain("token-guardado")
    expect(JSON.stringify(status)).not.toContain("token-del-entorno")
    expect(status.fields.token).toEqual({ configured: true, source: "system_settings" })
    expect(status.fields.mode).toEqual({ configured: true, source: "environment", value: "simulate" })
    expect(status.hasStoredSettings).toBe(true)
    expect(status.canStoreSecrets).toBe(true)
  })

  it("sin llavero dice que no se pueden guardar secretos", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    const status = await readSettingsAdminStatus(group, ENV)
    expect(status.canStoreSecrets).toBe(false)
    expect(canStoreSettingsSecrets()).toBe(false)
  })
})

describe("saveSettingsGroup", () => {
  it("cifra el secreto y audita dentro de la transacción, sin el valor", async () => {
    stubKeyring()
    const result = await saveSettingsGroup(group, { set: { token: "nuevo-token", mode: "apply" } }, actor)
    expect(result).toEqual({ changed: true, updated: ["token", "mode"], cleared: [] })
    const tokenWrite = mocks.writes.find((w) => w.key === "talana.api_token")!
    expect(tokenWrite.value.startsWith("enc:v1:k1:")).toBe(true)
    expect(mocks.writes.find((w) => w.key === "talana.sync_mode")!.value).toBe("apply")
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.auditsInTx).toEqual([true])
    expect(JSON.stringify(mocks.audits[0])).not.toContain("nuevo-token")
    expect(mocks.audits[0]).toMatchObject({
      action: "update",
      entityType: "test_settings",
      entityId: "test",
      oldState: { mode: null },
      newState: { tokenUpdated: true, mode: "apply" },
    })
  })

  it("no recorta el secreto: un espacio puede ser parte de la clave", async () => {
    stubKeyring()
    await saveSettingsGroup(group, { set: { token: " con espacios " } }, actor)
    const { decryptDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")
    const write = mocks.writes.find((w) => w.key === "talana.api_token")!
    expect(decryptDteSetting(write.value, "talana.api_token")).toBe(" con espacios ")
  })

  it("vacío conserva: no escribe ni audita", async () => {
    stubKeyring()
    const result = await saveSettingsGroup(group, { set: { token: "", mode: undefined } }, actor)
    expect(result.changed).toBe(false)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("re-guardar los mismos valores no es un cambio", async () => {
    stubKeyring()
    mocks.rows = [
      { key: "talana.api_token", value: encryptDteSetting("igual", "talana.api_token") },
      { key: "talana.sync_mode", value: "simulate" },
    ]
    const result = await saveSettingsGroup(group, { set: { token: "igual", mode: "simulate" } }, actor)
    expect(result.changed).toBe(false)
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("sin llavero rechaza un secreto sin escribir nada ni auditar", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    await expect(saveSettingsGroup(group, { set: { token: "x", mode: "apply" } }, actor))
      .rejects.toMatchObject({ code: "SETTINGS_KEYRING_REQUIRED" })
    expect(mocks.writes).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("sin llavero sí guarda un campo no secreto", async () => {
    vi.stubEnv("DTE_SETTINGS_KEYRING", "")
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
    const result = await saveSettingsGroup(group, { set: { mode: "off" } }, actor)
    expect(result.changed).toBe(true)
    expect(mocks.writes).toEqual([{ key: "talana.sync_mode", value: "off", updatedAt: expect.any(String) }])
  })

  it("borrar un campo guardado lo quita y lo audita como borrado", async () => {
    stubKeyring()
    mocks.rows = [{ key: "talana.api_token", value: encryptDteSetting("viejo", "talana.api_token") }]
    const result = await saveSettingsGroup(group, { clear: ["token"] }, actor)
    expect(result).toEqual({ changed: true, updated: [], cleared: ["token"] })
    expect(mocks.deletedKeys).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ newState: { tokenCleared: true } })
  })

  it("borrar algo que no está guardado no es un cambio", async () => {
    const result = await saveSettingsGroup(group, { clear: ["token"] }, actor)
    expect(result.changed).toBe(false)
    expect(mocks.audits).toEqual([])
  })

  it("escribir y borrar el mismo campo a la vez se rechaza", async () => {
    stubKeyring()
    await expect(saveSettingsGroup(group, { set: { token: "x" }, clear: ["token"] }, actor))
      .rejects.toBeInstanceOf(EncryptedSettingsError)
    expect(mocks.writes).toEqual([])
  })
})

describe("clearSettingsGroup", () => {
  it("borra lo guardado y audita qué campos se fueron", async () => {
    mocks.rows = [{ key: "talana.sync_mode", value: "apply" }]
    const result = await clearSettingsGroup(group, actor)
    expect(result.changed).toBe(true)
    expect(mocks.deletedKeys).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({ action: "delete", newState: { cleared: ["mode"] } })
  })

  it("sin nada guardado no hace nada", async () => {
    const result = await clearSettingsGroup(group, actor)
    expect(result.changed).toBe(false)
    expect(mocks.audits).toEqual([])
  })
})
