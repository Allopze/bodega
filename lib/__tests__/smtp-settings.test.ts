/**
 * Tests for Resend status helpers (replaces old SMTP-settings tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getResendStatus, testResendConnection } from "@/lib/services/smtp-settings"

// sendEmail is the dependency of testResendConnection
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from "@/lib/email/smtp"

const originalKey = process.env.RESEND_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalKey
})

describe("getResendStatus", () => {
  it("reports configured=true and a key prefix when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_live_abcdefghij"
    const status = getResendStatus()
    expect(status.configured).toBe(true)
    expect(status.apiKeyPrefix).toBe("re_liv…")
    expect(status.from).toBe("plataforma@portalchome.cl")
  })

  it("reports configured=false when RESEND_API_KEY is absent", () => {
    delete process.env.RESEND_API_KEY
    const status = getResendStatus()
    expect(status.configured).toBe(false)
    expect(status.apiKeyPrefix).toBe("—")
  })

  it("reports configured=false when RESEND_API_KEY is an empty string", () => {
    process.env.RESEND_API_KEY = "  "
    const status = getResendStatus()
    expect(status.configured).toBe(false)
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
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "RESEND_API_KEY no configurado" })
    const result = await testResendConnection("admin@example.cl")
    expect(result).toEqual({ ok: false, error: "RESEND_API_KEY no configurado" })
  })
})
