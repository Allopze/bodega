/**
 * Safe mail facade.
 *
 * Outbound SMTP delivery is intentionally paused while the project uses
 * next-auth@5 beta: Auth.js declares a vulnerable optional nodemailer peer, and
 * installing a patched nodemailer version breaks clean `npm ci` peer
 * resolution. Callers keep receiving the same `{ sent: false }` shape they
 * already use to expose a manual invitation/reset link fallback.
 */
import { getEmailsEnabled } from "@/lib/services/system-settings"

type InvitationEmailInput = {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}

type SendResult = { sent: true } | { sent: false; reason: string }

const SMTP_PAUSED_REASON = "SMTP deshabilitado temporalmente por seguridad"

export function getAppBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

export async function sendInvitationEmail(_input: InvitationEmailInput): Promise<SendResult> {
  return pausedMailResult()
}

export async function sendEmail(_message: {
  to:      string
  subject: string
  text:    string
  html:    string
}): Promise<SendResult> {
  return pausedMailResult()
}

export async function sendBatchEmails(
  _messages: Array<{ to: string; subject: string; text: string; html: string }>,
): Promise<{ sent: true; count: number } | { sent: false; reason: string }> {
  return pausedMailResult()
}

async function pausedMailResult(): Promise<{ sent: false; reason: string }> {
  if (process.env.SMTP_DISABLED === "true" || !(await getEmailsEnabled())) {
    return { sent: false, reason: "SMTP no configurado" }
  }

  return { sent: false, reason: SMTP_PAUSED_REASON }
}

export { Buffer }
