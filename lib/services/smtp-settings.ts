/**
 * Resend delivery status helpers — replaces the old SMTP DB config service.
 *
 * Configuration is entirely env-based: set RESEND_API_KEY.
 * The "from" address is hardcoded to the verified Resend domain.
 */
import { sendEmail } from "@/lib/email/smtp"

export const RESEND_FROM = "plataforma@portalchome.cl"
export const RESEND_FROM_DISPLAY = `Plataforma Chome <${RESEND_FROM}>`

export type ResendStatus = {
  configured: boolean
  from: string
  apiKeyPrefix: string
}

export function getResendStatus(): ResendStatus {
  const key = process.env.RESEND_API_KEY?.trim() ?? ""
  return {
    configured: key.length > 0,
    from: RESEND_FROM,
    apiKeyPrefix: key.length > 0 ? `${key.slice(0, 6)}…` : "—",
  }
}

export async function testResendConnection(
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await sendEmail({
    to,
    subject: "Correo de prueba — Plataforma Chome",
    text: "Este es un correo de prueba enviado desde Plataforma Chome para verificar que Resend está correctamente configurado.",
    html: `
      <p>Este es un correo de prueba enviado desde <strong>Plataforma Chome</strong>.</p>
      <p style="color:#6b7280;font-size:13px">Puedes ignorar este mensaje.</p>
    `,
  })
  if (result.sent) return { ok: true }
  return { ok: false, error: result.reason }
}
