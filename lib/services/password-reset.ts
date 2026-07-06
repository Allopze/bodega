"use server"

import crypto from "node:crypto"
import { eq, and, isNull, lt } from "drizzle-orm"
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

  // Invalidate any existing unused tokens for this user
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(
      eq(passwordResetTokens.userId, user.id),
      isNull(passwordResetTokens.usedAt),
    ))

  const rawToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  await db.insert(passwordResetTokens).values({
    id:        nanoid(),
    userId:    user.id,
    tokenHash,
    expiresAt,
  })

  const resetUrl = `${getAppBaseUrl()}/recuperar/${rawToken}`
  const safeName = user.name ?? "Usuario"

  sendEmail({
    to:      user.email,
    subject: "Restablecer contraseña — Plataforma Chome",
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

/** Applies the new password and marks the token as used. Both in a transaction. */
export async function applyPasswordReset(rawToken: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const tokenHash = hashToken(rawToken)

  try {
    await db.transaction(async (tx) => {
      const row = await tx.query.passwordResetTokens.findFirst({
        where: and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
        ),
      })

      if (!row) throw new Error("Token inválido o ya utilizado.")
      if (new Date(row.expiresAt) < new Date()) throw new Error("El enlace de recuperación ha expirado.")

      const bcrypt = await import("bcryptjs")
      const hashedPassword = await bcrypt.hash(newPassword, 12)

      await tx.update(users)
        .set({ hashedPassword, updatedAt: new Date().toISOString() })
        .where(eq(users.id, row.userId))

      await tx.update(passwordResetTokens)
        .set({ usedAt: new Date().toISOString() })
        .where(eq(passwordResetTokens.id, row.id))
    })

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al restablecer la contraseña."
    return { ok: false, error: message }
  }
}

/** Cleanup: delete expired or used tokens older than 7 days. */
export async function pruneResetTokens(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.createdAt, cutoff))
}
