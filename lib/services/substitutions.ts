import { and, desc, eq, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { userRoles, users, worksiteUsers } from "@/db/schema"
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

  // Obtener el usuario original a reemplazar
  const [originalUser] = await db.select().from(users).where(eq(users.id, data.substituteForUserId)).limit(1)
  if (!originalUser) throw new Error("Usuario a reemplazar no encontrado.")

  // Copiar sus roles y faenas
  const roles = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, originalUser.id))
  const worksites = await db.select({ worksiteId: worksiteUsers.worksiteId }).from(worksiteUsers).where(eq(worksiteUsers.userId, originalUser.id))

  const now = new Date()
  const validUntilDate = new Date(now.getTime() + data.validUntilDays * 24 * 60 * 60 * 1000)

  const [created] = await db.insert(users).values({
    id: `sub-${nanoid()}`,
    name: data.name,
    email: data.email,
    hashedPassword: "TEMPORARY_ACCOUNT_PENDING_SETUP",
    isActive: true,
    isTemporary: true,
    validUntil: validUntilDate.toISOString(),
    substituteForUserId: originalUser.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }).returning()
  if (!created) throw new Error("No se pudo crear el usuario temporal.")

  // Clonar roles
  for (const r of roles) {
    await db.insert(userRoles).values({
      userId: created.id,
      roleId: r.roleId,
    }).onConflictDoNothing()
  }

  // Clonar faenas
  for (const w of worksites) {
    await db.insert(worksiteUsers).values({
      userId: created.id,
      worksiteId: w.worksiteId,
    }).onConflictDoNothing()
  }

  logger.info(
    { temporaryUserId: created.id, substituteForUserId: originalUser.id, createdByUserId, validUntil: validUntilDate.toISOString() },
    "[Substitutions] Cuenta temporal de reemplazo creada.",
  )

  return created
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
