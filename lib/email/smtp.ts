/**
 * Outbound mail facade — powered by Resend.
 *
 * Configuration: la clave de API se guarda desde Administración › Correo
 * (cifrada en system_settings); si no hay una guardada se usa RESEND_API_KEY del
 * entorno. `readResendConfig` decide cuál (con una caché corta, porque se lee en
 * cada envío). All sends are no-ops when the key is absent or the global
 * emails kill-switch (system_settings: emails_enabled) is off.
 */
import { Resend } from "resend"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { readResendConfig } from "@/lib/services/resend-settings"
import { renderTemplate } from "@/lib/services/email-templates"

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

/** Cliente de Resend con la clave vigente (guardada o del entorno), o el motivo por el que no hay. */
async function getResend(): Promise<{ resend: Resend } | { reason: string }> {
  const { apiKey, unreadable } = await readResendConfig()
  if (apiKey) return { resend: new Resend(apiKey) }
  return {
    reason: unreadable
      ? "La clave de Resend guardada no se puede abrir con el llavero de este servidor"
      : "Clave de Resend no configurada",
  }
}

async function canSend(): Promise<{ ok: true; resend: Resend } | { ok: false; reason: string }> {
  if (!(await getEmailsEnabled())) {
    return { ok: false, reason: "Envío de correos desactivado" }
  }
  const transport = await getResend()
  if ("reason" in transport) return { ok: false, reason: transport.reason }
  return { ok: true, resend: transport.resend }
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<SendResult> {
  const { to, inviteUrl, invitedByName } = input

  const rendered = await renderTemplate("invitation", {
    sender_name: invitedByName ?? "",
    app_name:    "Plataforma Chome",
    invite_url:  inviteUrl,
  })

  const byLine = invitedByName
    ? `${invitedByName} te ha invitado a Plataforma Chome.`
    : "Has sido invitado a Plataforma Chome."
  const text = `${byLine}\n\nAccede aquí: ${inviteUrl}\n\nSi no esperabas esta invitación, ignora este correo.`

  return sendEmail({
    to,
    subject: rendered.subject,
    text,
    html:    rendered.html,
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

  const { error } = await gate.resend.emails.send({
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

  const { error } = await gate.resend.batch.send(
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
