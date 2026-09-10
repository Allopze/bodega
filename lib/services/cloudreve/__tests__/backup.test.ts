import { describe, expect, it } from "vitest"
import {
  backupRemoteKey,
  DEFAULT_BACKUP_CLOUDREVE_PATH,
  normalizeBackupCloudrevePath,
} from "../backup"

describe("normalizeBackupCloudrevePath", () => {
  it("usa el default cuando no hay valor", () => {
    expect(normalizeBackupCloudrevePath(undefined)).toBe(DEFAULT_BACKUP_CLOUDREVE_PATH)
    expect(normalizeBackupCloudrevePath(null)).toBe(DEFAULT_BACKUP_CLOUDREVE_PATH)
  })

  it("recorta slashes de los bordes", () => {
    expect(normalizeBackupCloudrevePath("  /backups/plataforma/  ")).toBe("backups/plataforma")
  })

  it("permite la raíz de la cuenta WebDAV", () => {
    expect(normalizeBackupCloudrevePath("/")).toBe("")
  })

  it("rechaza traversal, backslashes y caracteres de control", () => {
    expect(() => normalizeBackupCloudrevePath("../secret")).toThrow()
    expect(() => normalizeBackupCloudrevePath("backups\\plataforma")).toThrow()
    expect(() => normalizeBackupCloudrevePath("backups/\u0000")).toThrow()
  })
})

describe("backupRemoteKey", () => {
  it("arma la clave remota de un artefacto", () => {
    expect(backupRemoteKey("backups/plataforma", "2026-09-09", "postgres.dump"))
      .toBe("backups/plataforma/2026-09-09/postgres.dump")
    expect(backupRemoteKey("", "2026-09-09", "manifest.json"))
      .toBe("2026-09-09/manifest.json")
  })

  it("rechaza fechas y nombres de artefacto inválidos", () => {
    expect(() => backupRemoteKey("b", "09-09-2026", "postgres.dump")).toThrow()
    expect(() => backupRemoteKey("b", "2026-09-09", "../postgres.dump")).toThrow()
    expect(() => backupRemoteKey("b", "2026-09-09", "otro.bin")).toThrow()
  })
})
