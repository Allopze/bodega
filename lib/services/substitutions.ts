import { and, desc, eq, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { userInvitations, userRoles, users, worksiteUsers } from "@/db/schema"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { createPendingPasswordMarker } from "@/lib/auth/password-setup"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

const createSubstituteSchema = z.object({
  name: z.string().trim().min(3).max(100),
  email: z.string().trim().email(),
  substituteForUserId: z.string().min(1),
  validUntilDays: z.number().int().min(1).max(90).default(30),
})

export async function createTemporarySubstituteUser(input: unknown, createdByUserId: string) {
  const data = createSubstituteSchema.parse(input)
  const now = new Date()
  const nowIso = now.toISOString()
  const validUntilDate = new Date(now.getTime() + data.validUntilDays * 24 * 60 * 60 * 1000)
  const id = `sub-${nanoid()}`
  const invitationId = nanoid()
  const invitationToken = generateInvitationToken()

  const created = await db.transaction(async (tx) => {
    const [originalUser] = await tx.select().from(users).where(eq(users.id, data.substituteForUserId)).limit(1)
    if (!originalUser || !originalUser.isActive) throw new Error("Usuario a reemplazar no encontrado o inactivo.")

    const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1)
    if (existingUser) throw new Error("Este correo ya está registrado.")

    const [newUser] = await tx.insert(users).values({
      id,
      name: data.name,
      email: data.email,
      hashedPassword: createPendingPasswordMarker(),
      isActive: true,
      isTemporary: true,
      validUntil: validUntilDate.toISOString(),
      substituteForUserId: originalUser.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).returning()
    if (!newUser) throw new Error("No se pudo crear el usuario temporal.")

    const [roleRows, worksiteRows] = await Promise.all([
      tx.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, originalUser.id)),
      tx.select({ worksiteId: worksiteUsers.worksiteId, isPrimary: worksiteUsers.isPrimary }).from(worksiteUsers).where(eq(worksiteUsers.userId, originalUser.id)),
    ])
    if (roleRows.length > 0) {
      await tx.insert(userRoles).values(roleRows.map((role) => ({ userId: id, roleId: role.roleId })))
    }
    if (worksiteRows.length > 0) {
      await tx.insert(worksiteUsers).values(worksiteRows.map((worksite) => ({
        userId: id,
        worksiteId: worksite.worksiteId,
        isPrimary: worksite.isPrimary,
      })))
    }

    await tx.update(userInvitations)
      .set({ replacedAt: nowIso, replacedByInvitationId: invitationId })
      .where(and(
        eq(userInvitations.email, data.email),
        isNull(userInvitations.acceptedAt),
        isNull(userInvitations.cancelledAt),
        isNull(userInvitations.replacedAt),
      ))
    await tx.insert(userInvitations).values({
      id: invitationId,
      email: data.email,
      name: data.name,
      tokenHash: hashInvitationToken(invitationToken),
      roleIdsJson: JSON.stringify(roleRows.map((role) => role.roleId)),
      worksiteAssignmentsJson: JSON.stringify(worksiteRows.map((worksite) => ({
        worksiteId: worksite.worksiteId,
        isPrimary: worksite.isPrimary,
      }))),
      invitedByUserId: createdByUserId,
      expiresAt: validUntilDate.toISOString(),
      lastSentAt: nowIso,
      sendCount: 1,
    })

    return newUser
  })

  logger.info(
    { temporaryUserId: created.id, substituteForUserId: data.substituteForUserId, createdByUserId, validUntil: validUntilDate.toISOString() },
    "[Substitutions] Cuenta temporal de reemplazo creada.",
  )

  return { ...created, invitationToken, invitationExpiresAt: validUntilDate.toISOString() }
}

export async function extendTemporarySubstituteValidity(userId: string, additionalDays: number, updatedByUserId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !user.isTemporary) throw new Error("Cuenta temporal no encontrada.")

  const currentValidUntil = user.validUntil ? new Date(user.validUntil) : new Date()
  const newValidUntil = new Date(currentValidUntil.getTime() + additionalDays * 24 * 60 * 60 * 1000)

  const [updated] = await db.update(users).set({
    validUntil: newValidUntil.toISOString(),
    isActive: true,
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, userId)).returning()

  logger.info({ userId, extendedTo: newValidUntil.toISOString(), updatedByUserId }, "[Substitutions] Vigencia de cuenta temporal extendida.")
  return updated
}

export async function revokeTemporarySubstitute(userId: string, revokedByUserId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !user.isTemporary) throw new Error("Cuenta temporal no encontrada.")

  const [updated] = await db.update(users).set({
    isActive: false,
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, userId)).returning()

  logger.info({ userId, revokedByUserId }, "[Substitutions] Cuenta temporal revocada.")
  return updated
}

export async function listActiveSubstitutions() {
  return db.select({
    user: users,
    substituteForName: sql<string>`(SELECT u2.name FROM users u2 WHERE u2.id = ${users.substituteForUserId})`,
  })
    .from(users)
    .where(eq(users.isTemporary, true))
    .orderBy(desc(users.createdAt))
}

/** Desactiva automáticamente cuentas temporales vencidas */
export async function expireLapsedTemporaryUsers() {
  const now = new Date().toISOString()
  const updated = await db.update(users)
    .set({ isActive: false, updatedAt: now })
    .where(and(
      eq(users.isTemporary, true),
      eq(users.isActive, true),
      lte(users.validUntil, now),
    ))
    .returning({ id: users.id })

  if (updated.length > 0) {
    logger.info({ count: updated.length }, "[Substitutions] Cuentas temporales vencidas desactivadas.")
  }

  return { expiredCount: updated.length }
}
