import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

const {
  GENERATED_ARCHIVE_SETTING_KEYS,
  GeneratedArchiveSettingsError,
  readGeneratedArchiveEnvFlag,
  readGeneratedArchiveSettings,
  validateGeneratedArchiveSettings,
} = await import("@/lib/services/generated-documents/settings")
const { CLOUDREVE_SETTING_KEYS } = await import("@/lib/services/cloudreve/setting-keys")

const RESERVED = [
  { path: "storage/sst-documents", label: "la biblioteca de Documentación" },
  { path: "backups/plataforma", label: "los respaldos" },
]

afterEach(() => {
  delete process.env.GENERATED_DOCS_ARCHIVE_ENABLED
})

/** Un lector que devuelve filas de `system_settings` fijas. */
function reader(values: Record<string, string>) {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }))
  return { select: () => ({ from: () => ({ where: async () => rows }) }) } as never
}

describe("llave de entorno", () => {
  it("solo `true` la enciende", () => {
    expect(readGeneratedArchiveEnvFlag()).toBe(false)
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "1"
    expect(readGeneratedArchiveEnvFlag()).toBe(false)
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = " TRUE "
    expect(readGeneratedArchiveEnvFlag()).toBe(true)
  })

  it("con el switch encendido pero sin la llave de entorno, el archivado está apagado", async () => {
    const settings = await readGeneratedArchiveSettings(reader({ [GENERATED_ARCHIVE_SETTING_KEYS.enabled]: "true" }))
    expect(settings).toMatchObject({ switchOn: true, envEnabled: false, enabled: false })
  })

  it("una carpeta guardada inválida detiene el archivado en vez de adivinar otra", async () => {
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "true"
    const settings = await readGeneratedArchiveSettings(reader({
      [GENERATED_ARCHIVE_SETTING_KEYS.enabled]: "true",
      [GENERATED_ARCHIVE_SETTING_KEYS.basePath]: "a/../b",
    }))
    expect(settings).toMatchObject({ basePathInvalid: true, enabled: false })
  })

  it("las llaves no viven con las de Cloudreve: borrar las credenciales no las toca", () => {
    const cloudreveKeys = new Set<string>(Object.values(CLOUDREVE_SETTING_KEYS))
    for (const key of Object.values(GENERATED_ARCHIVE_SETTING_KEYS)) expect(cloudreveKeys.has(key)).toBe(false)
  })
})

describe("validateGeneratedArchiveSettings", () => {
  const input = { enabled: false, basePath: "Documentos generados", layout: "faena" as const }

  it("no se puede encender sin la llave de entorno ni sin credenciales", () => {
    expect(() => validateGeneratedArchiveSettings({ ...input, enabled: true }, { hasCredentials: true, reservedFolders: RESERVED }))
      .toThrow(GeneratedArchiveSettingsError)
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "true"
    expect(() => validateGeneratedArchiveSettings({ ...input, enabled: true }, { hasCredentials: false, reservedFolders: RESERVED }))
      .toThrow(/credenciales/)
    expect(validateGeneratedArchiveSettings({ ...input, enabled: true }, { hasCredentials: true, reservedFolders: RESERVED }))
      .toEqual({ enabled: true, basePath: "Documentos generados", layout: "faena" })
  })

  it("la carpeta no puede cruzarse con la biblioteca ni con los respaldos", () => {
    expect(() => validateGeneratedArchiveSettings({ ...input, basePath: "storage/sst-documents/Generados" }, { hasCredentials: true, reservedFolders: RESERVED }))
      .toThrow(/biblioteca de Documentación/)
    expect(() => validateGeneratedArchiveSettings({ ...input, basePath: "backups" }, { hasCredentials: true, reservedFolders: RESERVED }))
      .toThrow(/respaldos/)
  })

  it("rechaza un orden de carpetas desconocido", () => {
    expect(() => validateGeneratedArchiveSettings({ ...input, layout: "otro" as never }, { hasCredentials: true, reservedFolders: RESERVED }))
      .toThrow(/Orden/)
  })
})
