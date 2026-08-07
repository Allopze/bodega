/**
 * Tests para getSaStatusSummary()
 *
 * La función es pura: recibe un DriveHealth (o null) y retorna un resumen
 * textual con label, status y details[]. No depende de DB ni de Node.js APIs.
 *
 * Importamos desde el módulo real con mocks para @/db, @/lib/id y @/lib/logger
 * que son dependencias de otros exports en el mismo archivo.
 */
import { describe, expect, it, vi } from "vitest"

// ── Mocks de dependencias del módulo ─────────────────────────────────────────
// vitest hace hoisting automático de vi.mock(), por lo que los mocks se
// registran antes de que se evalúe cualquier import.

vi.mock("@/db", () => ({
  db: {
    insert:   vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    select:   vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    update:   vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete:   vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    query:    { backupLog: { findFirst: vi.fn().mockResolvedValue(null) } },
    transaction: vi.fn(),
  },
}))

vi.mock("@/lib/id", () => ({
  nanoid: () => "mocked-nanoid",
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import { getSaStatusSummary } from "./backups"
import type { DriveHealth } from "./backups"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDriveHealth(overrides: Partial<DriveHealth> = {}): DriveHealth {
  return {
    rcloneInstalled:  false,
    remoteConfigured: false,
    saJsonPresent:    false,
    saValid:          false,
    saEmail:          null,
    saPath:           null,
    saDetail:         "No se pudo verificar",
    reachable:        false,
    lastChecked:      null,
    rcloneConfPath:   null,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getSaStatusSummary", () => {
  // ── Null input ───────────────────────────────────────────────────────────

  it("retorna 'Sin verificar' cuando drive es null", () => {
    const result = getSaStatusSummary(null)
    expect(result.label).toBe("Sin verificar")
    expect(result.status).toBe("none")
    expect(result.details).toEqual(["Healthcheck no disponible"])
  })

  // ── No SA file ────────────────────────────────────────────────────────────

  it("retorna 'No configurado' (failed) cuando no hay SA JSON presente", () => {
    const drive = makeDriveHealth()
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("No configurado")
    expect(result.status).toBe("failed")
    expect(result.details).toContain("Archivo: no encontrado")
    expect(result.details).toContain("rclone.conf: no encontrado")
  })

  // ── SA file exists but invalid ────────────────────────────────────────────

  it("retorna 'SA inválido' (failed) cuando SA existe pero es inválido", () => {
    const drive = makeDriveHealth({
      saJsonPresent: true,
      saPath:        "/srv/bodega/secrets/gdrive-service-account.json",
      saDetail:      "JSON sin private_key válida",
    })
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("SA inválido")
    expect(result.status).toBe("failed")
    expect(result.details).toContain("Archivo: /srv/bodega/secrets/gdrive-service-account.json")
    expect(result.details).toContain("⚠️ JSON sin private_key válida")
  })

  it("retorna 'SA inválido' (failed) para JSON sin client_email", () => {
    const drive = makeDriveHealth({
      saJsonPresent: true,
      saValid:       false,
      saPath:        "/srv/bodega/secrets/gdrive-service-account.json",
      saDetail:      "JSON sin client_email de Service Account",
    })
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("SA inválido")
    expect(result.status).toBe("failed")
    expect(result.details).toContain("⚠️ JSON sin client_email de Service Account")
  })

  // ── SA valid + reachable ──────────────────────────────────────────────────

  it("retorna 'SA operativo' (success) cuando SA válido y Drive alcanzable", () => {
    const drive = makeDriveHealth({
      rcloneInstalled:  true,
      remoteConfigured: true,
      saJsonPresent:    true,
      saValid:          true,
      saEmail:          "sa-test@project.iam.gserviceaccount.com",
      saPath:           "/srv/bodega/secrets/gdrive-service-account.json",
      reachable:        true,
      rcloneConfPath:   "/home/user/.config/rclone/rclone.conf",
      lastChecked:      new Date().toISOString(),
    })
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("SA operativo")
    expect(result.status).toBe("success")
    expect(result.details).toContain("Archivo: /srv/bodega/secrets/gdrive-service-account.json")
    expect(result.details).toContain("Email: sa-test@project.iam.gserviceaccount.com")
    expect(result.details).toContain("Private key: presente ✓")
    expect(result.details).toContain("Token URI: correcto ✓")
    expect(result.details).toContain("rclone.conf: presente")
    expect(result.details).toContain("Conectividad Drive: OK ✓")
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Verificado hace \d+ min$/),
      ]),
    )
  })

  // ── SA valid + configured but unreachable ─────────────────────────────────

  it("retorna estado none cuando SA es válido, remote configurado pero no alcanzable", () => {
    const drive = makeDriveHealth({
      rcloneInstalled:  true,
      remoteConfigured: true,
      saJsonPresent:    true,
      saValid:          true,
      saEmail:          "sa@test.iam.gserviceaccount.com",
      saPath:           "/srv/bodega/secrets/gdrive-service-account.json",
      reachable:        false,
      rcloneConfPath:   "/home/user/.config/rclone/rclone.conf",
      lastChecked:      new Date().toISOString(),
    })
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("SA configurado, Drive inaccesible")
    expect(result.status).toBe("none")
    expect(result.details).toContain("rclone.conf: presente")
    expect(result.details).toContain("Conectividad Drive: error. Verifica conectividad de red")
  })

  // ── SA valid + not configured in rclone ───────────────────────────────────

  it("retorna estado none cuando SA presente pero remote no configurado", () => {
    const drive = makeDriveHealth({
      rcloneInstalled:  true,
      remoteConfigured: false,
      saJsonPresent:    true,
      saValid:          true,
      saPath:           "/srv/bodega/secrets/gdrive-service-account.json",
    })
    const result = getSaStatusSummary(drive)
    expect(result.label).toBe("SA presente, remote no configurado")
    expect(result.status).toBe("none")
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("incluye email solo cuando está presente", () => {
    const withEmail = makeDriveHealth({
      saJsonPresent: true,
      saValid:       true,
      saEmail:       "sa@test.iam.gserviceaccount.com",
      reachable:     true,
    })
    const result = getSaStatusSummary(withEmail)
    expect(result.details).toContain("Email: sa@test.iam.gserviceaccount.com")
  })

  it("no incluye email cuando es null", () => {
    const withoutEmail = makeDriveHealth({
      saJsonPresent: true,
      saValid:       true,
      saEmail:       null,
      reachable:     true,
    })
    const result = getSaStatusSummary(withoutEmail)
    expect(result.details).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Email:/)]),
    )
  })

  it("detecta ausencia de rclone.conf", () => {
    const drive = makeDriveHealth({
      rcloneConfPath: null,
    })
    const result = getSaStatusSummary(drive)
    expect(result.details).toContain("rclone.conf: no encontrado")
  })

  it("no muestra conectividad Drive cuando rclone no está instalado", () => {
    const drive = makeDriveHealth({
      rcloneInstalled:  false,
      remoteConfigured: false,
    })
    const result = getSaStatusSummary(drive)
    expect(result.details).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Conectividad Drive:/)]),
    )
  })

  it("no incluye timestamp 'Verificado hace' cuando lastChecked es null", () => {
    const drive = makeDriveHealth({
      lastChecked: null,
    })
    const result = getSaStatusSummary(drive)
    expect(result.details).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Verificado hace/)]),
    )
  })

  it("incluye detalles de SA inválido incluso sin rclone instalado", () => {
    const drive = makeDriveHealth({
      rcloneInstalled: false,
      saJsonPresent:   true,
      saValid:         false,
      saPath:          "/tmp/bad-sa.json",
      saDetail:        "JSON con token_uri incorrecto",
    })
    const result = getSaStatusSummary(drive)
    expect(result.status).toBe("failed")
    expect(result.label).toBe("SA inválido")
    expect(result.details).toContain("⚠️ JSON con token_uri incorrecto")
  })
})
