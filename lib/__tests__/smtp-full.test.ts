/**
 * Comprehensive tests for lib/email/smtp.ts
 *
 * Covers getAppBaseUrl, sendInvitationEmail, sendEmail, sendBatchEmails,
 * transport caching, and error propagation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const mockSendMail     = vi.hoisted(() => vi.fn())
const mockCreateTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: mockSendMail })))

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}))

vi.mock("@/lib/services/smtp-settings", () => ({
  getRawSmtpConfig: vi.fn(),
}))

vi.mock("@/lib/services/system-settings", () => ({
  getEmailsEnabled: vi.fn(),
}))

vi.mock("@/lib/services/email-templates", () => ({
  renderTemplate: vi.fn(),
}))

// ── Module under test ────────────────────────────────────────────────────────
import { getAppBaseUrl, sendEmail, sendInvitationEmail, sendBatchEmails } from "@/lib/email/smtp"
import { getRawSmtpConfig } from "@/lib/services/smtp-settings"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { renderTemplate } from "@/lib/services/email-templates"

// ── Helpers ──────────────────────────────────────────────────────────────────

const SMTP_ENV_KEYS = ["SMTP_DISABLED", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_PORT", "SMTP_SECURE"] as const
const APP_URL_KEYS  = ["APP_URL", "NEXTAUTH_URL"] as const

type EnvSnapshot = Partial<Record<string, string | undefined>>

function saveEnv(keys: readonly string[]): EnvSnapshot {
  return Object.fromEntries(keys.map((k) => [k, process.env[k]]))
}

function restoreEnv(keys: readonly string[], snapshot: EnvSnapshot) {
  for (const key of keys) {
    const val = snapshot[key]
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

let smtpEnvSnapshot: EnvSnapshot
let urlEnvSnapshot: EnvSnapshot

beforeEach(() => {
  vi.clearAllMocks()
  smtpEnvSnapshot = saveEnv(SMTP_ENV_KEYS)
  urlEnvSnapshot  = saveEnv(APP_URL_KEYS)
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
  // Clear SMTP env vars so tests start clean — each test sets what it needs
  for (const key of SMTP_ENV_KEYS) delete process.env[key]
  for (const key of APP_URL_KEYS) delete process.env[key]
})

afterEach(() => {
  restoreEnv(SMTP_ENV_KEYS, smtpEnvSnapshot)
  restoreEnv(APP_URL_KEYS, urlEnvSnapshot)
})

// ── getAppBaseUrl ────────────────────────────────────────────────────────────

describe("getAppBaseUrl", () => {
  afterEach(() => {
    delete process.env.APP_URL
    delete process.env.NEXTAUTH_URL
  })

  it("returns APP_URL when set", () => {
    process.env.APP_URL = "https://bodega.chome.cl"
    expect(getAppBaseUrl()).toBe("https://bodega.chome.cl")
  })

  it("returns NEXTAUTH_URL as fallback", () => {
    delete process.env.APP_URL
    process.env.NEXTAUTH_URL = "https://auth.chome.cl"
    expect(getAppBaseUrl()).toBe("https://auth.chome.cl")
  })

  it("defaults to localhost when neither is set", () => {
    delete process.env.APP_URL
    delete process.env.NEXTAUTH_URL
    expect(getAppBaseUrl()).toBe("http://localhost:3000")
  })

  it("strips trailing slash", () => {
    process.env.APP_URL = "https://bodega.chome.cl/"
    expect(getAppBaseUrl()).toBe("https://bodega.chome.cl")
  })

  it("prefers APP_URL over NEXTAUTH_URL", () => {
    process.env.APP_URL = "https://app.chome.cl"
    process.env.NEXTAUTH_URL = "https://auth.chome.cl"
    expect(getAppBaseUrl()).toBe("https://app.chome.cl")
  })
})

// ── sendInvitationEmail ──────────────────────────────────────────────────────

describe("sendInvitationEmail", () => {
  it("sends invitation via transport", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    vi.mocked(renderTemplate).mockResolvedValue({
      subject: "Invitación a Chome",
      html: "<p>Bienvenido</p>",
    })
    mockSendMail.mockResolvedValue({ messageId: "abc" })
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendInvitationEmail({
      to: "new@test.cl",
      inviteUrl: "https://bodega.cl/registro?token=xyz",
      invitedByName: "Admin Juan",
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@test.cl",
        subject: "Invitación a Chome",
      }),
    )
  })

  it("uses fallback text when template rendering fails", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    vi.mocked(renderTemplate).mockRejectedValue(new Error("Template error"))
    mockSendMail.mockResolvedValue({ messageId: "abc" })
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendInvitationEmail({
      to: "new@test.cl",
      inviteUrl: "https://bodega.cl/registro?token=xyz",
    })

    expect(result).toEqual({ sent: true })
    // Fallback subject should mention "Invitación"
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Invitación a Chome Solicitudes y Bodega",
      }),
    )
  })

  it("returns not-configured when SMTP config is null", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue(null)
    vi.mocked(getEmailsEnabled).mockResolvedValue(true)

    const result = await sendInvitationEmail({
      to: "new@test.cl",
      inviteUrl: "http://localhost:3000/registro?token=t1",
    })
    expect(result).toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("returns not-configured when emails are globally disabled", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)

    const result = await sendInvitationEmail({
      to: "new@test.cl",
      inviteUrl: "http://localhost:3000/registro?token=t1",
    })
    expect(result).toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("returns failure when transport throws", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    mockSendMail.mockRejectedValue(new Error("ECONNREFUSED"))
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendInvitationEmail({
      to: "fail@test.cl",
      inviteUrl: "http://localhost:3000/r?t=t1",
    })
    expect(result).toEqual({ sent: false, reason: "ECONNREFUSED" })
  })

  it("handles non-Error thrown by transport", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    mockSendMail.mockRejectedValue("string error")
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendInvitationEmail({
      to: "x@test.cl",
      inviteUrl: "http://localhost:3000/r?t=t1",
    })
    expect(result).toEqual({ sent: false, reason: "error desconocido" })
  })
})

// ── sendEmail ────────────────────────────────────────────────────────────────

describe("sendEmail", () => {
  it("sends a plain email", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    mockSendMail.mockResolvedValue({ messageId: "abc" })
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendEmail({
      to: "user@test.cl",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@test.cl", subject: "Test" }),
    )
  })

  it("returns not-configured when SMTP is disabled", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue(null)

    const result = await sendEmail({
      to: "x@test.cl",
      subject: "T",
      text: "T",
      html: "<p>T</p>",
    })
    expect(result).toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("returns failure on transport error", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    mockSendMail.mockRejectedValue(new Error("ETIMEDOUT"))
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendEmail({
      to: "x@test.cl", subject: "T", text: "T", html: "<p>T</p>",
    })
    expect(result).toEqual({ sent: false, reason: "ETIMEDOUT" })
  })
})

// ── sendBatchEmails ──────────────────────────────────────────────────────────

describe("sendBatchEmails", () => {
  it("sends multiple emails sequentially", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    mockSendMail.mockResolvedValue({ messageId: "abc" })
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    const result = await sendBatchEmails([
      { to: "a@test.cl", subject: "A", text: "A", html: "<p>A</p>" },
      { to: "b@test.cl", subject: "B", text: "B", html: "<p>B</p>" },
    ])

    expect(result).toEqual({ sent: true, count: 2 })
    expect(mockSendMail).toHaveBeenCalledTimes(2)
  })

  it("returns not-configured when SMTP is disabled", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue(null)

    const result = await sendBatchEmails([
      { to: "x@test.cl", subject: "T", text: "T", html: "<p>T</p>" },
    ])
    expect(result).toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("propagates transport error in batch", async () => {
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "smtp.test", port: 587, secure: false,
      user: "u", pass: "p", from: "noreply@test.cl",
    })
    // First send succeeds, second fails
    mockSendMail
      .mockResolvedValueOnce({ messageId: "1" })
      .mockRejectedValueOnce(new Error("ECONNRESET"))
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    await expect(sendBatchEmails([
      { to: "a@test.cl", subject: "A", text: "A", html: "<p>A</p>" },
      { to: "b@test.cl", subject: "B", text: "B", html: "<p>B</p>" },
    ])).rejects.toThrow("ECONNRESET")
  })
})

// ── Transport caching ────────────────────────────────────────────────────────

describe("transport caching", () => {
  it("reuses transport for same config", async () => {
    // Use a unique config to avoid stale cache from previous tests
    vi.mocked(getRawSmtpConfig).mockResolvedValue({
      host: "cache-test.smtp.local", port: 465, secure: true,
      user: "cache-user", pass: "cache-pass", from: "cache@test.cl",
    })
    mockSendMail.mockResolvedValue({ messageId: "abc" })
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail })

    await sendEmail({ to: "a@test.cl", subject: "A", text: "A", html: "<p>A</p>" })
    await sendEmail({ to: "b@test.cl", subject: "B", text: "B", html: "<p>B</p>" })

    // createTransport should only be called once (second send reuses)
    expect(mockCreateTransport).toHaveBeenCalledTimes(1)
  })
})
