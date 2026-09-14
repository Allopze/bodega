"use server"

import crypto from "node:crypto"
import { eq, and, gt, isNull } from "drizzle-orm"
import { db } from "@/db"
import { users, passwordResetTokens } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { sendEmail, getAppBaseUrl } from "@/lib/email/smtp"
import { logger } from "@/lib/logger"

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex")
}

/**
 * Generates a reset token for the given email and sends the email.
 * Always returns `true` to prevent user enumeration (even if email not found).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, normalizedEmail), eq(users.isActive, true)),
    columns: { id: true, name: true, email: true },
  })

  if (!user) {
    // Still wait a beat to prevent timing oracle
    await new Promise((r) => setTimeout(r, 80))
    return
  }

  const rawToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  /*
   * AUTH-002 (auditoría 2026-09-14): invalidar y emitir eran dos escrituras
   * sueltas. Dos solicitudes simultáneas se intercalaban —A invalida, B
   * invalida, A inserta, B inserta— y la cuenta quedaba con dos enlaces
   * válidos, cada uno capaz de restablecer la contraseña.
   *
   * Ahora es una sola transacción, y el índice parcial
   * `password_reset_tokens_one_active_per_user` la respalda: si dos corren a la
   * vez, la segunda choca contra el índice y no emite nada. Su titular ya
   * recibió el correo de la primera, así que se traga el error en silencio —el
   * contrato público de esta función es no revelar si la cuenta existe, y un
   * fallo visible aquí sería precisamente un oráculo de enumeración.
   */
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date().toISOString() })
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ))

      await tx.insert(passwordResetTokens).values({
        id:        nanoid(),
        userId:    user.id,
        tokenHash,
        expiresAt,
      })
    })
  } catch (err) {
    logger.warn("[password-reset] emisión concurrente descartada", err)
    return
  }

  const resetUrl = `${getAppBaseUrl()}/recuperar/${rawToken}`
  const safeName = user.name ?? "Usuario"

  sendEmail({
    to:      user.email,
    subject: "Restablecer contraseña en Plataforma Chome",
    text:    `Hola ${safeName},\n\nRecibiste este email porque solicitaste restablecer tu contraseña.\n\nHaz clic en el siguiente enlace (válido por 1 hora):\n${resetUrl}\n\nSi no solicitaste este cambio, puedes ignorar este email.`,
    html:    `
      <p>Hola <strong>${safeName}</strong>,</p>
      <p>Recibiste este email porque solicitaste restablecer tu contraseña.</p>
      <p><a href="${resetUrl}" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Restablecer contraseña</a></p>
      <p style="color:#6b7280;font-size:12px;">El enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este email.</p>
    `,
  }).catch((err) => {
    logger.error("[password-reset] failed to send reset email", err)
  })
}

export interface ValidateTokenResult {
  valid: boolean
  userId?: string
}

/** Validates a raw token (not hash). Returns userId if valid and unexpired. */
export async function validateResetToken(rawToken: string): Promise<ValidateTokenResult> {
  const tokenHash = hashToken(rawToken)

  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
    ),
  })

  if (!row) return { valid: false }
  if (new Date(row.expiresAt) < new Date()) return { valid: false }

  return { valid: true, userId: row.userId }
}

/** Reclama el token y, sólo si lo consiguió, escribe la contraseña. */
export async function applyPasswordReset(rawToken: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const tokenHash = hashToken(rawToken)

  try {
    await db.transaction(async (tx) => {
      /*
       * AUTH-002: antes se leía el token, se cambiaba la contraseña y recién
       * al final se marcaba usado por `id`, sin exigir que siguiera sin usar.
       * Dos aplicaciones simultáneas del mismo enlace leían la misma fila,
       * ambas escribían una contraseña distinta y ambas informaban éxito: cuál
       * quedaba dependía del orden de commit.
       *
       * Reclamar primero invierte el orden: el `UPDATE ... WHERE used_at IS
       * NULL ... RETURNING` es la sección crítica, y sólo una transacción se
       * lleva la fila. La otra no recibe nada y no toca la contraseña. La
       * expiración entra en la misma condición para que no haya ventana entre
       * comprobarla y consumir.
       */
      const [claimed] = await tx.update(passwordResetTokens)
        .set({ usedAt: new Date().toISOString() })
        .where(and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date().toISOString()),
        ))
        .returning({ userId: passwordResetTokens.userId })

      if (!claimed) {
        // No se distingue "no existe" de "ya usado" o "expiró": las tres son
        // "este enlace ya no sirve" y detallarlo sólo ayuda a quien prueba.
        throw new Error("El enlace de recuperación no es válido o ya fue utilizado.")
      }

      const bcrypt = await import("bcryptjs")
      const hashedPassword = await bcrypt.hash(newPassword, 12)

      await tx.update(users)
        .set({ hashedPassword, updatedAt: new Date().toISOString() })
        .where(eq(users.id, claimed.userId))
    })

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al restablecer la contraseña."
    return { ok: false, error: message }
  }
}
