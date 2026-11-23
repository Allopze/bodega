import { describe, expect, it } from "vitest"
import { pwaHeartbeatSchema } from "@/lib/pwa/heartbeat-contract"

const valid = {
  app: "ppa",
  deviceId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
  version: "3f9c2a1b7d0e",
  builtAt: "2026-11-22T17:05:00.000Z",
  sentAt: "2026-11-22T17:06:00.000Z",
  installed: true,
  platform: "Android · Chrome",
  pending: 0,
  failed: 0,
  oldestPendingAt: null,
  lastAttemptAt: null,
  lastError: null,
}

describe("formato del aviso", () => {
  it("acepta un aviso mínimo válido", () => {
    expect(pwaHeartbeatSchema.safeParse(valid).success).toBe(true)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, worksiteId: "w-1", linkHash: "a".repeat(64) }).success).toBe(true)
  })

  it("rechaza un campo extra", () => {
    expect(pwaHeartbeatSchema.safeParse({ ...valid, rut: "11.111.111-1" }).success).toBe(false)
  })

  it("rechaza conteos fuera de rango", () => {
    expect(pwaHeartbeatSchema.safeParse({ ...valid, pending: -1 }).success).toBe(false)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, pending: 10_001 }).success).toBe(false)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, failed: 1.5 }).success).toBe(false)
  })

  it("rechaza un error de más de 200 caracteres", () => {
    expect(pwaHeartbeatSchema.safeParse({ ...valid, lastError: "x".repeat(201) }).success).toBe(false)
  })

  it("rechaza un linkHash que no es SHA-256 hex", () => {
    expect(pwaHeartbeatSchema.safeParse({ ...valid, linkHash: "tok-1" }).success).toBe(false)
  })

  it("rechaza una app que no es del teléfono", () => {
    expect(pwaHeartbeatSchema.safeParse({ ...valid, app: "bodega" }).success).toBe(false)
  })

  it("exige sentAt, con offset y no anterior a 2020", () => {
    const { sentAt: _omitted, ...withoutSentAt } = valid
    expect(pwaHeartbeatSchema.safeParse(withoutSentAt).success).toBe(false)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, sentAt: null }).success).toBe(false)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, sentAt: "2026-11-22 17:06" }).success).toBe(false)
    expect(pwaHeartbeatSchema.safeParse({ ...valid, sentAt: "2026-11-22T14:06:00-03:00" }).success).toBe(true)
  })

  it("rechaza fechas anteriores a 2020 (Postgres no las admite como 0000-01-01)", () => {
    for (const field of ["builtAt", "sentAt", "oldestPendingAt", "lastAttemptAt"] as const) {
      expect(pwaHeartbeatSchema.safeParse({ ...valid, [field]: "0000-01-01T00:00:00Z" }).success, field).toBe(false)
      expect(pwaHeartbeatSchema.safeParse({ ...valid, [field]: "2019-12-31T23:59:59Z" }).success, field).toBe(false)
      expect(pwaHeartbeatSchema.safeParse({ ...valid, [field]: "2020-01-01T00:00:00Z" }).success, field).toBe(true)
    }
  })

  it("rechaza caracteres de control en toda cadena de texto", () => {
    for (const field of ["version", "platform", "lastError", "worksiteId"] as const) {
      for (const bad of ["a\u0000b", "a\nb", "a\tb", "a\u007Fb", "ok\n"]) {
        expect(pwaHeartbeatSchema.safeParse({ ...valid, [field]: bad }).success, `${field} ${JSON.stringify(bad)}`).toBe(false)
      }
    }
    // Texto con tildes, puntos medios y espacios normales sigue valiendo.
    expect(pwaHeartbeatSchema.safeParse({ ...valid, platform: "Android · Chrome", lastError: "No se envió: sin señal" }).success).toBe(true)
  })
})
