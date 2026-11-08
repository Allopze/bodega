/**
 * Clave de API de Resend administrable desde Administración › Correo (F4).
 *
 * Usa el helper compartido `encrypted-settings` de verdad (cifrado incluido, con
 * un llavero de prueba) y simula sólo la BD. Lo que se fija acá:
 *
 * - precedencia: lo guardado gana, el `.env` es el respaldo;
 * - un sobre ilegible NO cae al `.env` (sería enviar con la clave antigua);
 * - la caché de 30 s se invalida al guardar/restaurar y no se repuebla con una
 *   lectura que empezó antes de la invalidación;
 * - el estado para la pantalla jamás trae la clave, ni un prefijo;
 * - sin llavero no se escribe ni se audita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const KEY = "email.resend.api_key"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  failRead: false,
  selects: 0,
  /** Si está puesta, la lectura toma su foto de las filas y espera a que se libere. */
  hold: null as Promise<void> | null,
  audits: [] as Record<string, unknown>[],
  warnings: [] as string[],
}))

function selectChain() {
  return {
    from: () => ({
      where: async () => {
        mocks.selects += 1
        if (mocks.failRead) throw new Error("db down")
        const snapshot = mocks.rows.map((row) => ({ ...row }))
        if (mocks.hold) await mocks.hold
        return snapshot
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
          onConflictDoUpdate: async () => {
            mocks.rows = [...mocks.rows.filter((row) => row.key !== value.key), { key: value.key, value: value.value }]
          },
        }),
      }),
      delete: () => ({ where: async () => { mocks.rows = [] } }),
    }),
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: async (params: Record<string, unknown>) => { mocks.audits.push(params) },
}))
vi.mock("@/lib/logger", () => ({
  logger: { warn: (message: string) => { mocks.warnings.push(message) }, error: () => {} },
}))

const {
  readResendConfig,
  readResendAdminStatus,
  saveResendSettings,
  clearResendSettings,
  invalidateResendConfigCache,
  RESEND_SETTINGS_GROUP,
} = await import("../resend-settings")
const { encryptDteSetting, isEncryptedDteSetting } = await import("@/lib/services/dte-portal/settings-crypto")

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url")
function stubKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k1: TEST_KEY }))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k1")
}
function stubNoKeyring() {
  vi.stubEnv("DTE_SETTINGS_KEYRING", "")
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "")
}

const actor = { userId: "u1", userEmail: "admin@chome.cl" }

beforeEach(() => {
  mocks.rows = []
  mocks.failRead = false
  mocks.selects = 0
  mocks.hold = null
  mocks.audits = []
  mocks.warnings = []
  invalidateResendConfigCache()
  vi.stubEnv("RESEND_API_KEY", "")
  stubNoKeyring()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("RESEND_SETTINGS_GROUP", () => {
  it("auditará bajo resend_settings/resend y la clave física es la registrada", () => {
    expect(RESEND_SETTINGS_GROUP.entityType).toBe("resend_settings")
    expect(RESEND_SETTINGS_GROUP.entityId).toBe("resend")
    expect(RESEND_SETTINGS_GROUP.fields.apiKey).toEqual({ key: KEY, secret: true })
  })
})

describe("readResendConfig · precedencia", () => {
  it("sin nada guardado usa la clave del entorno", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    expect(await readResendConfig()).toEqual({ apiKey: "re_env_key", source: "environment", unreadable: false })
  })

  it("recorta los espacios de la clave del entorno", async () => {
    vi.stubEnv("RESEND_API_KEY", "  re_env_key \n")
    expect((await readResendConfig()).apiKey).toBe("re_env_key")
  })

  it("sin clave en ningún lado queda «sin configurar»", async () => {
    expect(await readResendConfig()).toEqual({ apiKey: "", source: "missing", unreadable: false })
  })

  it("lo guardado en la plataforma gana sobre el entorno", async () => {
    stubKeyring()
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    expect(await readResendConfig()).toEqual({ apiKey: "re_stored_key", source: "system_settings", unreadable: false })
  })

  it("ignora una clave guardada en claro (sólo puede venir de una escritura a mano)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.rows = [{ key: KEY, value: "re_en_claro" }]
    const config = await readResendConfig()
    expect(config.apiKey).toBe("re_env_key")
    expect(config.source).toBe("environment")
  })

  it("un sobre ilegible NO cae al entorno: sería enviar con la clave antigua", async () => {
    stubKeyring()
    const envelope = encryptDteSetting("re_stored_key", KEY)
    vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify({ k2: Buffer.alloc(32, 9).toString("base64url") }))
    vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", "k2")
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.rows = [{ key: KEY, value: envelope }]
    expect(await readResendConfig()).toEqual({ apiKey: "", source: "missing", unreadable: true })
  })

  it("si la BD no responde usa el entorno y lo deja en el log", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.failRead = true
    const config = await readResendConfig()
    expect(config).toEqual({ apiKey: "re_env_key", source: "environment", unreadable: false })
    expect(mocks.warnings.some((w) => w.includes("no se pudieron leer"))).toBe(true)
  })
})

describe("readResendConfig · caché de 30 s", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"))
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
  })

  it("no consulta la BD en cada envío", async () => {
    await readResendConfig()
    await readResendConfig()
    await readResendConfig()
    expect(mocks.selects).toBe(1)
  })

  it("vuelve a consultar cuando pasan los 30 s", async () => {
    await readResendConfig()
    vi.advanceTimersByTime(29_000)
    await readResendConfig()
    expect(mocks.selects).toBe(1)
    vi.advanceTimersByTime(2_000)
    await readResendConfig()
    expect(mocks.selects).toBe(2)
  })

  it("las lecturas simultáneas comparten una sola consulta", async () => {
    const results = await Promise.all([readResendConfig(), readResendConfig(), readResendConfig()])
    expect(mocks.selects).toBe(1)
    expect(new Set(results.map((r) => r.apiKey))).toEqual(new Set(["re_env_key"]))
  })

  it("invalidateResendConfigCache fuerza una lectura nueva", async () => {
    await readResendConfig()
    invalidateResendConfigCache()
    await readResendConfig()
    expect(mocks.selects).toBe(2)
  })

  it("una lectura que empezó antes de invalidar no repuebla la caché con el valor viejo", async () => {
    stubKeyring()
    let release!: () => void
    mocks.hold = new Promise<void>((resolve) => { release = resolve })

    const stale = readResendConfig() // toma la foto sin clave guardada y espera
    invalidateResendConfigCache()
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_new_key", KEY) }]
    mocks.hold = null
    release()
    expect((await stale).apiKey).toBe("re_env_key")

    // Si la lectura vieja hubiera repoblado la caché, esto devolvería re_env_key.
    expect((await readResendConfig()).apiKey).toBe("re_new_key")
    expect(mocks.selects).toBe(2)
  })
})

describe("readResendAdminStatus · lo que llega a la pantalla", () => {
  it("dice que hay clave y de dónde viene, sin la clave ni un prefijo", async () => {
    stubKeyring()
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_live_supersecretvalue", KEY) }]
    const status = await readResendAdminStatus()
    expect(status).toEqual({
      configured: true,
      source: "system_settings",
      hasStoredSettings: true,
      canStoreSecrets: true,
    })
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("supersecretvalue")
    expect(serialized).not.toContain("re_live")
  })

  it("con la clave sólo en el entorno no la revela y no habilita «Restaurar»", async () => {
    stubKeyring()
    vi.stubEnv("RESEND_API_KEY", "re_env_supersecret")
    const status = await readResendAdminStatus()
    expect(status).toEqual({
      configured: true,
      source: "environment",
      hasStoredSettings: false,
      canStoreSecrets: true,
    })
    expect(JSON.stringify(status)).not.toContain("supersecret")
  })

  it("sin llavero avisa que no se puede guardar", async () => {
    const status = await readResendAdminStatus()
    expect(status.canStoreSecrets).toBe(false)
    expect(status).toMatchObject({ configured: false, source: "missing" })
  })

  it("no usa la caché: refleja de inmediato lo recién guardado", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    await readResendConfig() // puebla la caché
    stubKeyring()
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    expect((await readResendAdminStatus()).source).toBe("system_settings")
  })
})

describe("saveResendSettings", () => {
  it("guarda la clave cifrada y la deja vigente de inmediato (invalida la caché)", async () => {
    stubKeyring()
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    expect((await readResendConfig()).apiKey).toBe("re_env_key") // puebla la caché

    const result = await saveResendSettings({ apiKey: "re_new_key" }, actor)
    expect(result).toEqual({ changed: true, updated: ["apiKey"], cleared: [] })

    const stored = mocks.rows.find((row) => row.key === KEY)!
    expect(isEncryptedDteSetting(stored.value)).toBe(true)
    expect(stored.value).not.toContain("re_new_key")

    expect(await readResendConfig()).toEqual({ apiKey: "re_new_key", source: "system_settings", unreadable: false })
  })

  it("audita qué cambió, nunca la clave", async () => {
    stubKeyring()
    await saveResendSettings({ apiKey: "re_new_key" }, actor)
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      userId: "u1",
      userEmail: "admin@chome.cl",
      action: "update",
      entityType: "resend_settings",
      entityId: "resend",
      newState: { apiKeyUpdated: true },
    })
    expect(JSON.stringify(mocks.audits)).not.toContain("re_new_key")
  })

  it("un campo vacío conserva la clave guardada y no audita", async () => {
    stubKeyring()
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    const before = mocks.rows[0]!.value
    const result = await saveResendSettings({ apiKey: "" }, actor)
    expect(result.changed).toBe(false)
    expect(mocks.rows[0]!.value).toBe(before)
    expect(mocks.audits).toHaveLength(0)
  })

  it("sin llavero rechaza el guardado sin escribir ni auditar", async () => {
    await expect(saveResendSettings({ apiKey: "re_new_key" }, actor))
      .rejects.toMatchObject({ code: "SETTINGS_KEYRING_REQUIRED" })
    expect(mocks.rows).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it("«Borrar» retira la clave guardada: vuelve la del entorno, ya sin la caché vieja", async () => {
    stubKeyring()
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    expect((await readResendConfig()).apiKey).toBe("re_stored_key") // puebla la caché

    const result = await saveResendSettings({ clearApiKey: true }, actor)
    expect(result).toEqual({ changed: true, updated: [], cleared: ["apiKey"] })
    expect(mocks.audits[0]).toMatchObject({ newState: { apiKeyCleared: true } })
    expect(await readResendConfig()).toEqual({ apiKey: "re_env_key", source: "environment", unreadable: false })
  })

  it("escribir y borrar la clave a la vez se rechaza", async () => {
    stubKeyring()
    await expect(saveResendSettings({ apiKey: "re_new_key", clearApiKey: true }, actor))
      .rejects.toMatchObject({ code: "SETTINGS_FIELD_CONFLICT" })
    expect(mocks.rows).toEqual([])
  })

  it("invalida la caché también cuando el guardado falla (no deja un valor dudoso)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    await readResendConfig()
    expect(mocks.selects).toBe(1)
    await expect(saveResendSettings({ apiKey: "re_new_key" }, actor)).rejects.toThrow()
    await readResendConfig()
    expect(mocks.selects).toBe(2)
  })
})

describe("clearResendSettings", () => {
  it("borra lo guardado, audita y devuelve el mando al entorno", async () => {
    stubKeyring()
    vi.stubEnv("RESEND_API_KEY", "re_env_key")
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    expect((await readResendConfig()).source).toBe("system_settings") // puebla la caché

    expect(await clearResendSettings(actor)).toEqual({ changed: true })
    expect(mocks.rows).toEqual([])
    expect(mocks.audits[0]).toMatchObject({ action: "delete", entityType: "resend_settings", entityId: "resend" })
    expect(await readResendConfig()).toMatchObject({ apiKey: "re_env_key", source: "environment" })
  })

  it("sin nada guardado no cambia ni audita", async () => {
    expect(await clearResendSettings(actor)).toEqual({ changed: false })
    expect(mocks.audits).toEqual([])
  })

  it("funciona sin llavero: restaurar no necesita cifrar nada", async () => {
    stubKeyring()
    mocks.rows = [{ key: KEY, value: encryptDteSetting("re_stored_key", KEY) }]
    stubNoKeyring()
    expect(await clearResendSettings(actor)).toEqual({ changed: true })
  })
})
