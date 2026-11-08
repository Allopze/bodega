import { beforeEach, describe, expect, it, vi } from "vitest"
import { Resend } from "resend"
import { sendEmail, sendInvitationEmail, sendBatchEmails } from "@/lib/email/smtp"
import { getEmailsEnabled } from "@/lib/services/system-settings"

vi.mock("@/lib/services/system-settings", () => ({
  getEmailsEnabled: vi.fn(async () => true),
}))

vi.mock("@/lib/services/email-templates", () => ({
  renderTemplate: vi.fn(async (_key: string, vars: Record<string, string>) => ({
    subject: `Invitación a ${vars.app_name ?? "Plataforma Chome"}`,
    html:    `<p>${vars.sender_name ? `<strong>${vars.sender_name}</strong> te ha invitado a` : "Has sido invitado a"} <strong>${vars.app_name ?? "Plataforma Chome"}</strong>.</p><p><a href="${vars.invite_url ?? ""}">Aceptar invitación</a></p>`,
  })),
}))

const { mockSend, mockBatchSend, mockReadResendConfig } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockBatchSend: vi.fn(),
  mockReadResendConfig: vi.fn(),
}))

vi.mock("resend", () => ({ Resend: vi.fn() }))

// La clave vigente (guardada en la plataforma o del entorno) la decide
// `readResendConfig`; su precedencia se prueba en `resend-settings.test.ts`.
vi.mock("@/lib/services/resend-settings", () => ({ readResendConfig: mockReadResendConfig }))

const KEY_PRESENT = { apiKey: "re_test_key", source: "environment", unreadable: false }
const KEY_MISSING = { apiKey: "", source: "missing", unreadable: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
  mockReadResendConfig.mockResolvedValue(KEY_PRESENT)
  mockSend.mockResolvedValue({ data: { id: "msg_1" }, error: null })
  mockBatchSend.mockResolvedValue({ data: { data: [{ id: "msg_1" }] }, error: null })
  vi.mocked(Resend).mockImplementation(function () {
    return { emails: { send: mockSend }, batch: { send: mockBatchSend } }
  } as never)
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

  it("returns { sent: false } when no Resend key is configured", async () => {
    mockReadResendConfig.mockResolvedValue(KEY_MISSING)
    const result = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(result).toEqual({ sent: false, reason: "Clave de Resend no configurada" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("explains when the stored key cannot be opened with this server's keyring", async () => {
    mockReadResendConfig.mockResolvedValue({ apiKey: "", source: "missing", unreadable: true })
    const result = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(result).toEqual({
      sent: false,
      reason: expect.stringContaining("no se puede abrir con el llavero"),
    })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("builds the Resend client with the effective key from readResendConfig", async () => {
    mockReadResendConfig.mockResolvedValue({ apiKey: "re_stored_key", source: "system_settings", unreadable: false })
    await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(Resend).toHaveBeenCalledWith("re_stored_key")
  })

  it("does not read the key when the kill-switch is already off", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)
    await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(mockReadResendConfig).not.toHaveBeenCalled()
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

  it("returns { sent: false } when no Resend key is configured", async () => {
    mockReadResendConfig.mockResolvedValue(KEY_MISSING)
    const result = await sendBatchEmails([
      { to: "a@example.cl", subject: "A", text: "a", html: "<p>a</p>" },
    ])
    expect(result).toEqual({ sent: false, reason: "Clave de Resend no configurada" })
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
