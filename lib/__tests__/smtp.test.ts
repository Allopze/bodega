import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sendInvitationEmail } from "@/lib/email/smtp"
import { getEmailsEnabled } from "@/lib/services/system-settings"

// The global kill-switch is the first gate in getSmtpConfig(). Mock it so we
// can exercise both the "paused" and "normal" paths without a real DB.
vi.mock("@/lib/services/system-settings", () => ({
  getEmailsEnabled: vi.fn(async () => true),
}))

const SMTP_ENV_KEYS = ["SMTP_DISABLED", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const
const originalEnv = Object.fromEntries(SMTP_ENV_KEYS.map((key) => [key, process.env[key]]))

beforeEach(() => {
  vi.mocked(getEmailsEnabled).mockResolvedValue(true)
})

afterEach(() => {
  for (const key of SMTP_ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("smtp mailer", () => {
  it("does not attempt delivery when SMTP is explicitly disabled", async () => {
    process.env.SMTP_DISABLED = "true"
    process.env.SMTP_HOST = "smtp.example.test"
    process.env.SMTP_USER = "user"
    process.env.SMTP_PASS = "secret"
    process.env.SMTP_FROM = "from@example.test"

    await expect(sendInvitationEmail({
      to: "recipient@example.test",
      inviteUrl: "http://localhost:3000/registro?token=test",
    })).resolves.toEqual({ sent: false, reason: "SMTP no configurado" })
  })

  it("does not attempt delivery when the global email kill-switch is off", async () => {
    vi.mocked(getEmailsEnabled).mockResolvedValue(false)
    // Fully valid SMTP config: only the global switch should stop delivery.
    process.env.SMTP_HOST = "smtp.example.test"
    process.env.SMTP_USER = "user"
    process.env.SMTP_PASS = "secret"
    process.env.SMTP_FROM = "from@example.test"

    await expect(sendInvitationEmail({
      to: "recipient@example.test",
      inviteUrl: "http://localhost:3000/registro?token=test",
    })).resolves.toEqual({ sent: false, reason: "SMTP no configurado" })
  })
})
