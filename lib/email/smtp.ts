/**
 * SMTP mailer backed by nodemailer.
 *
 * Audit S-11: the previous implementation was a hand-rolled SMTP
 * client vulnerable to memory exhaustion (unbounded response buffer)
 * and to leaked timers holding the process alive. We now delegate
 * all transport concerns to nodemailer, which is the de-facto standard
 * Node.js library, actively maintained, and tested across hundreds
 * of SMTP servers.
 *
 * The public function shape is preserved so callers (Server Actions,
 * notifications) don't need to change. Internally we build a
 * nodemailer transport on demand, reusing a single transport per
 * process when possible.
 *
 * SMTP config now reads from the database first (admin-configurable),
 * falling back to environment variables for backward compatibility.
 */
import { randomUUID } from "node:crypto"
import nodemailer, { type Transporter } from "nodemailer"
import { getRawSmtpConfig } from "@/lib/services/smtp-settings"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { renderTemplate } from "@/lib/services/email-templates"

type InvitationEmailInput = {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  from: string
}

type SendResult = { sent: true } | { sent: false; reason: string }

let cachedTransport: Transporter | null = null
let cachedConfig: SmtpConfig | null = null

export function getAppBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

/**
 * Load SMTP config from DB first, fall back to env vars.
 * Returns null if neither source has a complete configuration.
 */
async function getSmtpConfig(): Promise<SmtpConfig | null> {
  // 0. Global kill-switch: when the admin disables system emails, no outbound
  // mail is sent. Every send primitive funnels through here, so returning null
  // pauses notifications, password resets and invitations at once. The admin's
  // "test SMTP" path uses getRawSmtpConfig directly, so it stays unaffected.
  if (!(await getEmailsEnabled())) return null

  // 1. Try DB config (admin-configurable)
  const dbConfig = await getRawSmtpConfig()
  if (dbConfig) {
    return {
      host: dbConfig.host,
      port: dbConfig.port,
      secure: dbConfig.secure,
      auth: { user: dbConfig.user, pass: dbConfig.pass },
      from: dbConfig.from,
    }
  }

  // 2. Fall back to environment variables
  if (process.env.SMTP_DISABLED === "true") return null

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user

  if (!host || !user || !pass || !from) return null
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("SMTP_PORT inválido")
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    from,
  }
}

function getTransport(config: SmtpConfig): Transporter {
  // Reuse the transport when config hasn't changed.
  if (
    cachedTransport &&
    cachedConfig &&
    cachedConfig.host === config.host &&
    cachedConfig.port === config.port &&
    cachedConfig.secure === config.secure &&
    cachedConfig.auth.user === config.auth.user &&
    cachedConfig.auth.pass === config.auth.pass
  ) {
    return cachedTransport
  }

  cachedTransport = nodemailer.createTransport({
    host:    config.host,
    port:    config.port,
    secure:  config.secure,
    auth:    { user: config.auth.user, pass: config.auth.pass },
    // S-11 hardening: bound the time we're willing to wait on the
    // SMTP server, including connection, greeting and TLS handshake.
    connectionTimeout: 5_000,
    greetingTimeout:   5_000,
    socketTimeout:     10_000,
  })
  cachedConfig = config
  return cachedTransport
}

export async function sendInvitationEmail({ to, inviteUrl, invitedByName }: InvitationEmailInput): Promise<SendResult> {
  const config = await getSmtpConfig()
  if (!config) return { sent: false, reason: "SMTP no configurado" }

  const senderName = invitedByName ?? "Un administrador"
  const text = `${senderName} te invitó a Chome Solicitudes y Bodega.\n\nCompleta tu registro usando este enlace:\n${inviteUrl}\n\nSi no esperabas esta invitación, puedes ignorar este correo.`

  let renderedSubject = "Invitación a Chome Solicitudes y Bodega"
  let renderedHtml = [
    `<p>${escapeHtml(senderName)} te invitó a <strong>Chome Solicitudes y Bodega</strong>.</p>`,
    `<p><a href="${escapeHtml(inviteUrl)}">Completar registro</a></p>`,
    `<p>Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
  ].join("")

  try {
    const rendered = await renderTemplate("invitation", {
      sender_name: senderName,
      app_name:    "Chome Solicitudes y Bodega",
      invite_url:  inviteUrl,
    })
    renderedSubject = rendered.subject
    renderedHtml = rendered.html
  } catch {
    // Fallback to inline defaults
  }

  return await sendViaTransport(config, {
    to,
    subject: renderedSubject,
    text,
    html: renderedHtml,
  })
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to:      string
  subject: string
  text:    string
  html:    string
}): Promise<SendResult> {
  const config = await getSmtpConfig()
  if (!config) return { sent: false, reason: "SMTP no configurado" }

  return await sendViaTransport(config, { to, subject, text, html })
}

export async function sendBatchEmails(
  messages: Array<{ to: string; subject: string; text: string; html: string }>,
): Promise<{ sent: true; count: number } | { sent: false; reason: string }> {
  const config = await getSmtpConfig()
  if (!config) return { sent: false, reason: "SMTP no configurado" }

  const transport = getTransport(config)
  // Nodemailer reuses the connection across sequential sends on the
  // same transporter, so a single transport + sequential sends is
  // strictly better than opening N connections.
  for (const msg of messages) {
    await transport.sendMail({
      from:    config.from,
      to:      msg.to,
      subject: msg.subject,
      text:    msg.text,
      html:    msg.html,
      headers: { "X-Chome-Bulk": "true" },
      messageId: `<${randomUUID()}@chome.local>`,
    })
  }
  return { sent: true, count: messages.length }
}

// ── Internals ────────────────────────────────────────────────────────────────

async function sendViaTransport(
  config: SmtpConfig,
  message: { to: string; subject: string; text: string; html: string },
): Promise<SendResult> {
  try {
    const transport = getTransport(config)
    await transport.sendMail({
      from:    config.from,
      to:      message.to,
      subject: message.subject,
      text:    message.text,
      html:    message.html,
      messageId: `<${randomUUID()}@chome.local>`,
    })
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "error desconocido" }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// Re-exported to keep the public surface intact for code that imported
// the previous `Buffer` reference for size checks.
export { Buffer }
