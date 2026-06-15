"use server"

import bcrypt from "bcryptjs"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { userInvitations, users } from "@/db/schema"
import { hashInvitationToken } from "@/lib/auth/bootstrap"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/services/rate-limit"

const passwordSetupSchema = z.object({
  email:           z.string().email().transform((value) => value.toLowerCase().trim()),
  password:        z.string().min(8, "Mínimo 8 caracteres"),
  confirmPassword: z.string().min(1, "Confirma la contraseña"),
  token:           z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().min(1, "Necesitas una invitación válida para crear la contraseña"),
  ),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
})

export async function setInitialPassword(input: {
  email: string
  password: string
  confirmPassword: string
  token?: string
}): Promise<{
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
}> {
  const parsed = passwordSetupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { email, password, token } = parsed.data
  const rateKey = `initial-password:${email}`
  const limit = await checkRateLimit(rateKey)
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(limit.waitTimeRemainingMs / 60000)} minutos.`,
    }
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (!user || !user.isActive || !isPasswordSetupPending(user.hashedPassword)) {
    await recordFailure(rateKey)
    return { ok: false, message: "Esta cuenta no está pendiente de contraseña" }
  }

  const invitation = await db.query.userInvitations.findFirst({
    where: and(
      eq(userInvitations.tokenHash, hashInvitationToken(token)),
      isNull(userInvitations.acceptedAt),
    ),
  })
  if (!invitation || invitation.email !== email) {
    await recordFailure(rateKey)
    return { ok: false, fieldErrors: { token: ["Invitación inválida o ya utilizada"] } }
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    await recordFailure(rateKey)
    return { ok: false, fieldErrors: { token: ["La invitación expiró"] } }
  }

  const hashedPassword = await bcrypt.hash(password, 12)
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      hashedPassword,
      updatedAt: new Date().toISOString(),
    }).where(eq(users.id, user.id))
    await tx.update(userInvitations).set({
      acceptedAt: new Date().toISOString(),
    }).where(eq(userInvitations.id, invitation.id))
  })

  await recordSuccess(rateKey)
  return { ok: true, message: "Contraseña creada. Iniciando sesión..." }
}
