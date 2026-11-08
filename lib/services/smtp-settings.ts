/**
 * Resend delivery status helpers — replaces the old SMTP DB config service.
 *
 * La clave de API se administra desde Administración › Correo y se guarda
 * cifrada en `system_settings`; si no hay una guardada se usa `RESEND_API_KEY`
 * del `.env` del servidor (ver `resend-settings.ts`). Lo que sale de acá hacia
 * la pantalla dice SI hay clave y de DÓNDE viene, nunca la clave ni un prefijo.
 * The "from" address is hardcoded to the verified Resend domain.
 */
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { auditLog } from "@/db/schema"
import { sendEmail } from "@/lib/email/smtp"
import { readResendAdminStatus, type ResendAdminStatus } from "@/lib/services/resend-settings"

export const RESEND_FROM = "plataforma@portalchome.cl"
export const RESEND_FROM_DISPLAY = `Plataforma Chome <${RESEND_FROM}>`

export type ResendStatus = ResendAdminStatus & {
  from: string
}

export async function getResendStatus(): Promise<ResendStatus> {
  return { ...(await readResendAdminStatus()), from: RESEND_FROM }
}

export type LastDeliveryTest = {
  attemptedAt: string
  recipient:   string | null
  ok:          boolean
  error:       string | null
}

/**
 * Última prueba de envío, leída de la auditoría (TASK-UI-011).
 *
 * La prueba ya se registraba, pero sólo hacia dentro: la pantalla seguía
 * diciendo "prueba de envío pendiente" para siempre, aunque se hubiera enviado
 * un correo con éxito cinco minutos antes. Un estado que nunca cambia no es un
 * estado, y obligaba a repetir la prueba para saber algo que el sistema ya
 * sabía. No se crea tabla nueva: la auditoría **es** el registro.
 */
export async function getLastDeliveryTest(): Promise<LastDeliveryTest | null> {
  const [row] = await db
    .select({ createdAt: auditLog.createdAt, newState: auditLog.newState })
    .from(auditLog)
    .where(eq(auditLog.entityType, "smtp_delivery_test"))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)

  if (!row) return null

  // `newState` es texto JSON escrito por esta misma aplicación, pero una
  // entrada corrupta no debe tumbar la pantalla de diagnóstico.
  let parsed: Record<string, unknown> = {}
  try {
    parsed = row.newState ? (JSON.parse(row.newState) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }

  return {
    attemptedAt: typeof parsed.attemptedAt === "string" ? parsed.attemptedAt : String(row.createdAt),
    recipient:   typeof parsed.recipient === "string" ? parsed.recipient : null,
    ok:          parsed.result === "sent",
    error:       typeof parsed.error === "string" ? parsed.error : null,
  }
}

export async function testResendConnection(
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await sendEmail({
    to,
    subject: "Correo de prueba de Plataforma Chome",
    text: "Este es un correo de prueba enviado desde Plataforma Chome para verificar que Resend está correctamente configurado.",
    html: `
      <p>Este es un correo de prueba enviado desde <strong>Plataforma Chome</strong>.</p>
      <p style="color:#6b7280;font-size:13px">Puedes ignorar este mensaje.</p>
    `,
  })
  if (result.sent) return { ok: true }
  return { ok: false, error: result.reason }
}
