import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Resend } from "resend"
import { sendEmail, sendInvitationEmail, sendBatchEmails } from "@/lib/email/smtp"
import { getEmailsEnabled } from "@/lib/services/system-settings"

vi.mock("@/lib/services/system-settings", () => ({
  getEmailsEnabled: vi.fn(async () => true),
}))

const { mockSend, mockBatchSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockBatchSend: vi.fn(),
}))

vi.mock("resend", () => ({ Resend: vi.fn() }))

const originalKey = process.env.RESEND_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
  process.env.RESEND_API_KEY = "re_test_key"
  mockSend.mockResolvedValue({ data: { id: "msg_1" }, error: null })
  mockBatchSend.mockResolvedValue({ data: { data: [{ id: "msg_1" }] }, error: null })
  vi.mocked(Resend).mockImplementation(function () {
    return { emails: { send: mockSend }, batch: { send: mockBatchSend } }
  } as never)
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalKey
})

describe("sendEmail", () => {
  it("sends via Resend and returns { sent: true }", async () => {
    const result = await sendEmail({
      to: "user@example.cl",
      subject: "Test",
      text: "hello",
      html: "<p>hello</p>",
    })
    expect(result).toEqual({ sent: true })
    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend.mock.calls[0]![0]).toMatchObject({
      from: expect.stringContaining("portalchome.cl"),
      to: "user@example.cl",
      subject: "Test",
    })
  })

  it("returns { sent: false } when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY
    const result = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(result).toEqual({ sent: false, reason: "RESEND_API_KEY no configurado" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("returns { sent: false } when the global kill-switch is off", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)
    const result = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(result).toEqual({ sent: false, reason: "Envío de correos desactivado" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("returns { sent: false } when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "Invalid API key" } })
    const result = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(result).toEqual({ sent: false, reason: "Invalid API key" })
  })
})

describe("sendInvitationEmail", () => {
  it("sends an invitation and returns { sent: true }", async () => {
    const result = await sendInvitationEmail({
      to: "new@example.cl",
      inviteUrl: "https://app.example.cl/registro?token=abc",
      invitedByName: "Admin User",
    })
    expect(result).toEqual({ sent: true })
    expect(mockSend.mock.calls[0]![0].subject).toBe("Invitación a Plataforma Chome")
    expect(mockSend.mock.calls[0]![0].html).toContain("abc")
  })

  it("works without invitedByName", async () => {
    const result = await sendInvitationEmail({
      to: "new@example.cl",
      inviteUrl: "https://app.example.cl/registro?token=xyz",
    })
    expect(result).toEqual({ sent: true })
  })
})

describe("sendBatchEmails", () => {
  it("sends a batch and returns { sent: true, count }", async () => {
    const messages = [
      { to: "a@example.cl", subject: "A", text: "a", html: "<p>a</p>" },
      { to: "b@example.cl", subject: "B", text: "b", html: "<p>b</p>" },
    ]
    const result = await sendBatchEmails(messages)
    expect(result).toEqual({ sent: true, count: 2 })
    expect(mockBatchSend).toHaveBeenCalledOnce()
  })

  it("short-circuits with { sent: true, count: 0 } for empty input", async () => {
    const result = await sendBatchEmails([])
    expect(result).toEqual({ sent: true, count: 0 })
    expect(mockBatchSend).not.toHaveBeenCalled()
  })

  it("returns { sent: false } when Resend returns an error", async () => {
    mockBatchSend.mockResolvedValue({ data: null, error: { message: "rate limited" } })
    const result = await sendBatchEmails([
      { to: "a@example.cl", subject: "A", text: "a", html: "<p>a</p>" },
    ])
    expect(result).toEqual({ sent: false, reason: "rate limited" })
  })
})
