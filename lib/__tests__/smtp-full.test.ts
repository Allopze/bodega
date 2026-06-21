/**
 * Covers the safe SMTP facade used by invitations, notifications and password
 * reset flows while in-process SMTP delivery is paused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/services/system-settings", () => ({
  getEmailsEnabled: vi.fn(),
}))

vi.mock("@/lib/services/email-templates", () => ({
  renderTemplate: vi.fn(),
}))

import { getAppBaseUrl, sendBatchEmails, sendEmail, sendInvitationEmail } from "@/lib/email/smtp"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { renderTemplate } from "@/lib/services/email-templates"

const APP_URL_KEYS = ["APP_URL", "NEXTAUTH_URL"] as const

type EnvSnapshot = Partial<Record<string, string | undefined>>

function saveEnv(keys: readonly string[]): EnvSnapshot {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(keys: readonly string[], snapshot: EnvSnapshot) {
  for (const key of keys) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

let urlEnvSnapshot: EnvSnapshot

beforeEach(() => {
  vi.clearAllMocks()
  urlEnvSnapshot = saveEnv(APP_URL_KEYS)
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
  for (const key of APP_URL_KEYS) delete process.env[key]
})

afterEach(() => {
  restoreEnv(APP_URL_KEYS, urlEnvSnapshot)
})

describe("getAppBaseUrl", () => {
  it("returns APP_URL when set", () => {
    process.env.APP_URL = "https://bodega.chome.cl"
    expect(getAppBaseUrl()).toBe("https://bodega.chome.cl")
  })

  it("returns NEXTAUTH_URL as fallback", () => {
    process.env.NEXTAUTH_URL = "https://auth.chome.cl"
    expect(getAppBaseUrl()).toBe("https://auth.chome.cl")
  })

  it("defaults to localhost when neither is set", () => {
    expect(getAppBaseUrl()).toBe("http://localhost:3000")
  })

  it("strips trailing slash", () => {
    process.env.APP_URL = "https://bodega.chome.cl/"
    expect(getAppBaseUrl()).toBe("https://bodega.chome.cl")
  })
})

describe("safe mail facade", () => {
  it("returns a fallback result for invitation emails without loading a transport", async () => {
    vi.mocked(renderTemplate).mockResolvedValue({
      subject: "Invitación",
      html: "<p>Invitación</p>",
    })

    await expect(sendInvitationEmail({
      to: "new@test.cl",
      inviteUrl: "https://bodega.cl/registro?token=xyz",
      invitedByName: "Admin Juan",
    })).resolves.toEqual({
      sent: false,
      reason: "SMTP deshabilitado temporalmente por seguridad",
    })
  })

  it("returns the normal not-configured result when emails are globally disabled", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)

    await expect(sendEmail({
      to: "user@test.cl",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    })).resolves.toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("returns a fallback result for batch notifications", async () => {
    await expect(sendBatchEmails([
      { to: "a@test.cl", subject: "A", text: "A", html: "<p>A</p>" },
      { to: "b@test.cl", subject: "B", text: "B", html: "<p>B</p>" },
    ])).resolves.toEqual({
      sent: false,
      reason: "SMTP deshabilitado temporalmente por seguridad",
    })
  })
})
