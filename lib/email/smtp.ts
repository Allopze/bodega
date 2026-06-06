import nodemailer from "nodemailer"

type InvitationEmailInput = {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}

export function getAppBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user

  if (!host || !user || !pass || !from) return null

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    from,
  }
}

export async function sendInvitationEmail({ to, inviteUrl, invitedByName }: InvitationEmailInput) {
  const config = getSmtpConfig()
  if (!config) return { sent: false as const, reason: "SMTP no configurado" }
  const senderName = invitedByName ?? "Un administrador"
  const escapedSenderName = escapeHtml(senderName)
  const escapedInviteUrl = escapeHtml(inviteUrl)

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  })

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "Invitación a Chome Solicitudes y Bodega",
    text: [
      `${senderName} te invitó a Chome Solicitudes y Bodega.`,
      "",
      "Completa tu registro usando este enlace:",
      inviteUrl,
      "",
      "Si no esperabas esta invitación, puedes ignorar este correo.",
    ].join("\n"),
    html: [
      `<p>${escapedSenderName} te invitó a <strong>Chome Solicitudes y Bodega</strong>.</p>`,
      `<p><a href="${escapedInviteUrl}">Completar registro</a></p>`,
      `<p>Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
    ].join(""),
  })

  return { sent: true as const }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
