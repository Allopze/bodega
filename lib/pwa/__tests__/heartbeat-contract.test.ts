import { describe, expect, it } from "vitest"
import { pwaHeartbeatSchema } from "@/lib/pwa/heartbeat-contract"

const valid = {
  app: "ppa",
  deviceId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
  version: "3f9c2a1b7d0e",
  builtAt: "2026-11-22T17:05:00.000Z",
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
})
