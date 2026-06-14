import { afterEach, describe, expect, it } from "vitest"

import { sendInvitationEmail } from "@/lib/email/smtp"

const SMTP_ENV_KEYS = ["SMTP_DISABLED", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const
const originalEnv = Object.fromEntries(SMTP_ENV_KEYS.map((key) => [key, process.env[key]]))

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
})
