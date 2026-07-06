/**
 * Outbound mail facade — powered by Resend.
 *
 * Configuration: set RESEND_API_KEY in the environment.
 * All sends are no-ops when the key is absent or the global
 * emails kill-switch (system_settings: emails_enabled) is off.
 */
import { Resend } from "resend"
import { getEmailsEnabled } from "@/lib/services/system-settings"

const FROM = "Plataforma Chome <plataforma@portalchome.cl>"

export function getAppBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "")
}

type InvitationEmailInput = {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}

export type SendResult = { sent: true } | { sent: false; reason: string }

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  return key ? new Resend(key) : null
}

async function canSend(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!(await getEmailsEnabled())) {
    return { ok: false, reason: "Envío de correos desactivado" }
  }
  if (!getResend()) {
    return { ok: false, reason: "RESEND_API_KEY no configurado" }
  }
  return { ok: true }
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<SendResult> {
  const { to, inviteUrl, invitedByName } = input
  const byLine = invitedByName
    ? `<strong>${invitedByName}</strong> te ha invitado a`
    : "Has sido invitado a"

  return sendEmail({
    to,
    subject: "Invitación a Plataforma Chome",
    text: `${invitedByName ? `${invitedByName} te ha invitado a` : "Has sido invitado a"} Plataforma Chome.\n\nAccede aquí: ${inviteUrl}\n\nSi no esperabas esta invitación, ignora este correo.`,
    html: `
      <p>${byLine} <strong>Plataforma Chome</strong>.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 20px;background:#17422b;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Aceptar invitación</a></p>
      <p style="color:#6b7280;font-size:13px">Si no esperabas esta invitación, ignora este correo.</p>
    `,
  })
}

export async function sendEmail(message: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<SendResult> {
  const gate = await canSend()
  if (!gate.ok) return { sent: false, reason: gate.reason }

  const resend = getResend()!
  const { error } = await resend.emails.send({
    from: FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  if (error) return { sent: false, reason: error.message }
  return { sent: true }
}

export async function sendBatchEmails(
  messages: Array<{ to: string; subject: string; text: string; html: string }>,
): Promise<{ sent: true; count: number } | { sent: false; reason: string }> {
  if (messages.length === 0) return { sent: true, count: 0 }

  const gate = await canSend()
  if (!gate.ok) return { sent: false, reason: gate.reason }

  const resend = getResend()!
  const { error } = await resend.batch.send(
    messages.map((m) => ({
      from: FROM,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    })),
  )

  if (error) return { sent: false, reason: error.message }
  return { sent: true, count: messages.length }
}

// Re-export Buffer so callers that import it from here keep working.
export { Buffer }
