/**
 * Integration-style tests for the Resend mail facade.
 * Verifies the full send path including kill-switch and key-missing guards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Resend } from "resend"
import { sendEmail, sendBatchEmails, sendInvitationEmail } from "@/lib/email/smtp"
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

// La clave vigente la decide `readResendConfig` (precedencia en `resend-settings.test.ts`).
vi.mock("@/lib/services/resend-settings", () => ({ readResendConfig: mockReadResendConfig }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
  mockReadResendConfig.mockResolvedValue({ apiKey: "re_test_full", source: "environment", unreadable: false })
  mockSend.mockResolvedValue({ data: { id: "id1" }, error: null })
  mockBatchSend.mockResolvedValue({ data: { data: [{ id: "id1" }] }, error: null })
  vi.mocked(Resend).mockImplementation(function () {
    return { emails: { send: mockSend }, batch: { send: mockBatchSend } }
  } as never)
})

describe("kill-switch precedence", () => {
  it("kill-switch blocks even when API key is present", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)
    const r = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(r).toMatchObject({ sent: false, reason: expect.stringContaining("desactivado") })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("missing key blocks even when kill-switch is on", async () => {
    mockReadResendConfig.mockResolvedValue({ apiKey: "", source: "missing", unreadable: false })
    const r = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(r).toMatchObject({ sent: false, reason: expect.stringContaining("Clave de Resend") })
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe("sendEmail — from address", () => {
  it("always sends from the portalchome.cl domain", async () => {
    await sendEmail({ to: "x@x.cl", subject: "s", text: "t", html: "h" })
    expect(mockSend.mock.calls[0]![0].from).toContain("portalchome.cl")
  })
})

describe("sendInvitationEmail", () => {
  it("includes the invite URL in both text and html", async () => {
    await sendInvitationEmail({ to: "x@x.cl", inviteUrl: "https://app.cl/registro?token=tok" })
    const call = mockSend.mock.calls[0]![0]
    expect(call.text).toContain("tok")
    expect(call.html).toContain("tok")
  })

  it("mentions the inviter name when provided", async () => {
    await sendInvitationEmail({ to: "x@x.cl", inviteUrl: "https://app.cl/r", invitedByName: "María" })
    expect(mockSend.mock.calls[0]![0].html).toContain("María")
  })
})

describe("sendBatchEmails", () => {
  it("passes all messages to Resend batch API", async () => {
    const msgs = Array.from({ length: 3 }, (_, i) => ({
      to: `u${i}@x.cl`, subject: `S${i}`, text: `t${i}`, html: `<p>${i}</p>`,
    }))
    const r = await sendBatchEmails(msgs)
    expect(r).toEqual({ sent: true, count: 3 })
    expect(mockBatchSend.mock.calls[0]![0]).toHaveLength(3)
  })

  it("all messages use the canonical from address", async () => {
    await sendBatchEmails([{ to: "a@x.cl", subject: "s", text: "t", html: "h" }])
    const payloads: { from: string }[] = mockBatchSend.mock.calls[0]![0]
    expect(payloads.every((p) => p.from.includes("portalchome.cl"))).toBe(true)
  })
})
