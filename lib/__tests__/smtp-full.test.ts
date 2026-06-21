/**
 * Integration-style tests for the Resend mail facade.
 * Verifies the full send path including kill-switch and key-missing guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Resend } from "resend"
import { sendEmail, sendBatchEmails, sendInvitationEmail } from "@/lib/email/smtp"
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
  process.env.RESEND_API_KEY = "re_test_full"
  mockSend.mockResolvedValue({ data: { id: "id1" }, error: null })
  mockBatchSend.mockResolvedValue({ data: { data: [{ id: "id1" }] }, error: null })
  vi.mocked(Resend).mockImplementation(function () {
    return { emails: { send: mockSend }, batch: { send: mockBatchSend } }
  } as never)
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalKey
})

describe("kill-switch precedence", () => {
  it("kill-switch blocks even when API key is present", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)
    const r = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(r).toMatchObject({ sent: false, reason: expect.stringContaining("desactivado") })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("missing key blocks even when kill-switch is on", async () => {
    delete process.env.RESEND_API_KEY
    const r = await sendEmail({ to: "a@b.cl", subject: "x", text: "x", html: "x" })
    expect(r).toMatchObject({ sent: false, reason: expect.stringContaining("RESEND_API_KEY") })
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
