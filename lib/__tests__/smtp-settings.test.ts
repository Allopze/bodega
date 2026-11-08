/**
 * Tests for Resend status helpers (replaces old SMTP-settings tests).
 *
 * `getResendStatus` compone el estado seguro de la clave (origen, sin valor) con
 * el remitente fijo; la precedencia guardado/entorno se prueba en
 * `lib/services/__tests__/resend-settings.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockReadResendAdminStatus = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/resend-settings", () => ({
  readResendAdminStatus: mockReadResendAdminStatus,
}))

// sendEmail is the dependency of testResendConnection
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(),
}))

vi.mock("@/db", () => ({ db: {} }))

import { getResendStatus, testResendConnection } from "@/lib/services/smtp-settings"
import { sendEmail } from "@/lib/email/smtp"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getResendStatus", () => {
  it("reports configured=true with the source of the key and the fixed sender", async () => {
    mockReadResendAdminStatus.mockResolvedValue({
      configured: true,
      source: "system_settings",
      hasStoredSettings: true,
      canStoreSecrets: true,
    })
    const status = await getResendStatus()
    expect(status).toEqual({
      configured: true,
      source: "system_settings",
      hasStoredSettings: true,
      canStoreSecrets: true,
      from: "plataforma@portalchome.cl",
    })
  })

  it("reports configured=false when there is no key anywhere", async () => {
    mockReadResendAdminStatus.mockResolvedValue({
      configured: false,
      source: "missing",
      hasStoredSettings: false,
      canStoreSecrets: false,
    })
    const status = await getResendStatus()
    expect(status.configured).toBe(false)
    expect(status.source).toBe("missing")
  })

  it("no longer exposes any part of the key (the old prefix is gone)", async () => {
    mockReadResendAdminStatus.mockResolvedValue({
      configured: true,
      source: "environment",
      hasStoredSettings: false,
      canStoreSecrets: true,
    })
    const status = await getResendStatus()
    expect(status).not.toHaveProperty("apiKeyPrefix")
    expect(status).not.toHaveProperty("apiKey")
  })
})

describe("testResendConnection", () => {
  it("returns { ok: true } when sendEmail succeeds", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ sent: true })
    const result = await testResendConnection("admin@example.cl")
    expect(result).toEqual({ ok: true })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.cl" }),
    )
  })

  it("returns { ok: false, error } when sendEmail fails", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "Clave de Resend no configurada" })
    const result = await testResendConnection("admin@example.cl")
    expect(result).toEqual({ ok: false, error: "Clave de Resend no configurada" })
  })
})
