import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as { key: string; value: string }[],
  failRead: false,
  warnings: [] as string[],
}))

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (mocks.failRead) throw new Error("db down")
          return mocks.rows
        },
      }),
    }),
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: async () => {} }))
vi.mock("@/lib/logger", () => ({
  logger: { warn: (message: string) => { mocks.warnings.push(message) }, error: () => {} },
}))

const {
  loadSalesSyncConfig,
  readSalesSyncAdminStatus,
  readSalesSyncConfig,
  salesSyncSettingsGroup,
} = await import("../config")

const KEY = "billing.sales.sync_enabled"

beforeEach(() => {
  mocks.rows = []
  mocks.failRead = false
  mocks.warnings = []
  vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "")
  vi.stubEnv("BILLING_HISTORY_FLOOR", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("grupo de ajustes de la sincronización de ventas", () => {
  it("guarda el interruptor en su key, sin cifrar, y audita con su propia entidad", () => {
    expect(salesSyncSettingsGroup.fields.syncEnabled).toEqual({ key: KEY, secret: false })
    expect(salesSyncSettingsGroup.entityType).toBe("billing_sales_settings")
    expect(salesSyncSettingsGroup.entityId).toBe("sales_sync")
  })
})

describe("loadSalesSyncConfig", () => {
  it("sin nada guardado sigue al .env: encendido", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: true, source: "environment" })
  })

  it("sin nada guardado sigue al .env: apagado explícito", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "false")
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: false, source: "environment" })
  })

  it("sin nada guardado ni variable queda apagado y «sin configurar»", async () => {
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: false, source: "missing" })
  })

  it("lo guardado gana sobre el .env, en los dos sentidos", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    mocks.rows = [{ key: KEY, value: "false" }]
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: false, source: "system_settings" })

    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "false")
    mocks.rows = [{ key: KEY, value: "true" }]
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: true, source: "system_settings" })
  })

  it("con la BD caída cae al .env y deja un aviso en el log", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    mocks.failRead = true

    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: true, source: "environment" })
    expect(mocks.warnings.some((message) => message.includes("no se pudieron leer los ajustes persistidos"))).toBe(true)
  })

  it("una fila vacía se trata como no guardada", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    mocks.rows = [{ key: KEY, value: "" }]
    expect(await loadSalesSyncConfig()).toMatchObject({ enabled: true, source: "environment" })
  })

  it("el período mínimo sigue viniendo sólo del .env", async () => {
    mocks.rows = [{ key: KEY, value: "true" }]

    expect((await loadSalesSyncConfig()).historyFloor).toBe("2024-01")

    vi.stubEnv("BILLING_HISTORY_FLOOR", "2025-03")
    expect((await loadSalesSyncConfig()).historyFloor).toBe("2025-03")

    vi.stubEnv("BILLING_HISTORY_FLOOR", "marzo")
    expect((await loadSalesSyncConfig()).historyFloor).toBe("2024-01")
  })
})

describe("readSalesSyncConfig (respaldo del .env, síncrono)", () => {
  it("no mira lo guardado en la plataforma", () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "false")
    mocks.rows = [{ key: KEY, value: "true" }]
    expect(readSalesSyncConfig()).toEqual({ enabled: false, historyFloor: "2024-01" })
  })

  it("sólo «true» enciende", () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", " TRUE ")
    expect(readSalesSyncConfig().enabled).toBe(true)
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "1")
    expect(readSalesSyncConfig().enabled).toBe(false)
  })
})

describe("readSalesSyncAdminStatus", () => {
  it("sin nada guardado no ofrece restaurar y dice de dónde viene el valor", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    expect(await readSalesSyncAdminStatus()).toEqual({
      enabled: true,
      source: "environment",
      hasStoredSettings: false,
    })
  })

  it("con el interruptor guardado habilita «Restaurar»", async () => {
    vi.stubEnv("BILLING_SALES_SYNC_ENABLED", "true")
    mocks.rows = [{ key: KEY, value: "false" }]
    expect(await readSalesSyncAdminStatus()).toEqual({
      enabled: false,
      source: "system_settings",
      hasStoredSettings: true,
    })
  })

  it("sin variable ni fila queda apagado y sin configurar", async () => {
    expect(await readSalesSyncAdminStatus()).toEqual({
      enabled: false,
      source: "missing",
      hasStoredSettings: false,
    })
  })
})
