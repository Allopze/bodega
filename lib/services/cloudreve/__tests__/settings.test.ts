import { beforeEach, describe, expect, it, vi } from "vitest"

const written = vi.hoisted(() => [] as Array<{ key: string; value: string }>)
const deleted = vi.hoisted(() => [] as string[])

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    query: { systemSettings: { findFirst: vi.fn(async () => null) } },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        insert: vi.fn(() => ({
          values: (values: { key: string; value: string }) => {
            written.push(values)
            return { onConflictDoUpdate: vi.fn(async () => undefined) }
          },
        })),
        delete: vi.fn(() => ({
          where: vi.fn(async () => {
            deleted.push("batch")
            return undefined
          }),
        })),
      })
    }),
  },
}))

vi.mock("@/db/schema", () => ({
  systemSettings: { key: "key", value: "value", updatedAt: "updatedAt" },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }))

vi.mock("@/lib/services/dte-portal/settings-crypto", () => ({
  decryptDteSetting: vi.fn((value: string) => value.replace(/^enc:/, "")),
  encryptDteSetting: vi.fn((value: string) => `enc:${value}`),
  isEncryptedDteSetting: vi.fn((value: string) => value.startsWith("enc:")),
  readDteSettingsKeyring: vi.fn(() => ({ mode: "compat", activeKeyId: "k1", keys: new Map() })),
}))

import {
  clearCloudreveSettings,
  saveCloudreveSettings,
  CloudreveSettingsError,
} from "@/lib/services/cloudreve/settings"

describe("cloudreve settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    written.length = 0
    deleted.length = 0
  })

  it("persists secrets encrypted and functional values in clear", async () => {
    await saveCloudreveSettings(
      {
        baseUrl: "https://cloudreve.example.test/",
        username: "bodega-sst",
        password: "s3cret",
        sstPath: "/",
        backend: "cloudreve",
      },
      { userId: "admin-1" },
    )

    const byKey = new Map(written.map((row) => [row.key, row.value]))
    expect(byKey.get("storage.cloudreve.base_url")).toBe("https://cloudreve.example.test")
    expect(byKey.get("storage.cloudreve.username")).toBe("enc:bodega-sst")
    expect(byKey.get("storage.cloudreve.password")).toBe("enc:s3cret")
    expect(byKey.get("storage.cloudreve.sst_path")).toBe("")
    expect(byKey.get("storage.cloudreve.backend")).toBe("cloudreve")
  })

  it("clears fields explicitly without touching others", async () => {
    await saveCloudreveSettings(
      { clearUsername: true, clearPassword: true },
      { userId: "admin-1" },
    )
    // Sin writes (solo deletes): la transacción borra en bloque.
    expect(written).toHaveLength(0)
    expect(deleted).toContain("batch")
  })

  it("rejects an invalid backend value", async () => {
    await expect(saveCloudreveSettings(
      { backend: "s3" as never },
      { userId: "admin-1" },
    )).rejects.toThrow(/Backend de almacenamiento inválido/)
  })

  // Una URL sin esquema se persistía sin chistar y reventaba mucho después,
  // como un TypeError crudo dentro de cada subida y descarga.
  it("rejects a base URL that is not an absolute http(s) address", async () => {
    await expect(saveCloudreveSettings(
      { baseUrl: "cloudreve.example.test" },
      { userId: "admin-1" },
    )).rejects.toThrow(/dirección completa/i)
    expect(written).toHaveLength(0)
  })

  it("rejects a base URL with a non-http scheme", async () => {
    await expect(saveCloudreveSettings(
      { baseUrl: "ftp://cloudreve.example.test" },
      { userId: "admin-1" },
    )).rejects.toThrow(/http:\/\/ o https:\/\//i)
  })

  // Los DELETE corren después de los INSERT en la transacción: escribir y
  // borrar el mismo campo hacía desaparecer en silencio el valor recién puesto.
  it("rejects writing and clearing the same field in one save", async () => {
    await expect(saveCloudreveSettings(
      { password: "nueva", clearPassword: true },
      { userId: "admin-1" },
    )).rejects.toThrow(/escribir y borrar la contraseña/i)
    expect(written).toHaveLength(0)
    expect(deleted).toHaveLength(0)
  })

  // Activar Cloudreve sin credenciales rompe toda la biblioteca SST al instante.
  it("refuses to activate the cloudreve backend without complete credentials", async () => {
    await expect(saveCloudreveSettings(
      { backend: "cloudreve" },
      { userId: "admin-1" },
    )).rejects.toBeInstanceOf(CloudreveSettingsError)
    expect(written).toHaveLength(0)
  })

  it("activates the cloudreve backend when the same save supplies the credentials", async () => {
    await saveCloudreveSettings(
      {
        backend: "cloudreve",
        baseUrl: "https://cloudreve.example.test",
        username: "bodega-sst",
        password: "s3cret",
      },
      { userId: "admin-1" },
    )
    const byKey = new Map(written.map((row) => [row.key, row.value]))
    expect(byKey.get("storage.cloudreve.backend")).toBe("cloudreve")
  })

  it("allows going back to filesystem with no credentials at all", async () => {
    await saveCloudreveSettings({ backend: "filesystem" }, { userId: "admin-1" })
    const byKey = new Map(written.map((row) => [row.key, row.value]))
    expect(byKey.get("storage.cloudreve.backend")).toBe("filesystem")
  })

  it("clearCloudreveSettings deletes all keys", async () => {
    await clearCloudreveSettings({ userId: "admin-1" })
    expect(deleted).toContain("batch")
  })
})
