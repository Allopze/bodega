"use server"

import bcrypt from "bcryptjs"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { userInvitations, userRoles, users, worksiteUsers } from "@/db/schema"
import { ensureSystemRbac, hashInvitationToken } from "@/lib/auth/bootstrap"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/services/rate-limit"
import { registerUserSchema, type ActionState } from "@/lib/validation/masters"
import { headers } from "next/headers"

type WorksiteAssignment = { worksiteId: string; isPrimary: boolean }

// Advisory-lock key (constante arbitraria) que serializa la decisión de
// "primer usuario = admin", evitando que dos registros concurrentes sobre una
// base vacía se conviertan ambos en administrador.
const REGISTRATION_LOCK_KEY = 918_273_645

// Señal interna para abortar la transacción y mapear un fallo de validación a
// un ActionState (y registrarlo en el rate-limiter) fuera de ella.
class RegistrationRollback extends Error {}

export async function registerUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = {
    name:            formData.get("name"),
    email:           formData.get("email"),
    password:        formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    token:           formData.get("token") ?? "",
  }

  const parsed = registerUserSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const data = parsed.data

  // Rate-limit por IP y email (defensa en profundidad).
  let clientIp = "127.0.0.1"
  try {
    const h = await headers()
    clientIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  } catch {}

  const ipRateKey = `registro:ip:${clientIp}`
  const emailRateKey = `registro:email:${data.email}`

  const ipLimit = await checkRateLimit(ipRateKey)
  if (!ipLimit.allowed) {
    return {
      ok: false,
      message: `Demasiados intentos desde esta dirección. Intenta de nuevo en ${Math.ceil(ipLimit.waitTimeRemainingMs / 60000)} minutos.`,
    }
  }

  const emailLimit = await checkRateLimit(emailRateKey)
  if (!emailLimit.allowed) {
    return {
      ok: false,
      message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(emailLimit.waitTimeRemainingMs / 60000)} minutos.`,
    }
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, data.email) })
  const existingCanCompleteSetup = existing ? isPasswordSetupPending(existing.hashedPassword) : false
  if (existing && !existingCanCompleteSetup) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const id = existing?.id ?? nanoid()
  const hashedPassword = await bcrypt.hash(data.password, 12)
  const avatarColor = existing?.avatarColor ?? String(Math.abs(hashStr(data.name)) % 360)

  // Fallo de validación de invitación detectado bajo el lock, para mapearlo a
  // ActionState fuera de la transacción.
  let validationFailure: ActionState | null = null
  let isBootstrap = false

  try {
    await db.transaction(async (tx) => {
      // Serializa la decisión de primer-admin: sólo un registro evalúa el
      // conteo de usuarios a la vez (el lock se libera al commit/rollback).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`)

      const [countRow] = await tx.select({ value: count() }).from(users)
      const userCount = countRow?.value ?? 0

      let roleIds: string[] = ["rol-admin"]
      let worksiteAssignments: WorksiteAssignment[] = []
      let invitationId: string | null = null

      if (userCount === 0) {
        isBootstrap = true
        // Semilla idempotente de roles/permisos del sistema (incluye rol-admin),
        // dentro de la misma transacción.
        await ensureSystemRbac(tx)
      } else {
        if (!data.token) {
          validationFailure = { ok: false, fieldErrors: { token: ["Necesitas una invitación para registrarte"] } }
          throw new RegistrationRollback()
        }

        const invitation = await tx.query.userInvitations.findFirst({
          where: and(
            eq(userInvitations.tokenHash, hashInvitationToken(data.token)),
            isNull(userInvitations.acceptedAt),
          ),
        })

        if (!invitation) {
          validationFailure = { ok: false, fieldErrors: { token: ["Invitación inválida o ya utilizada"] } }
          throw new RegistrationRollback()
        }
        if (new Date(invitation.expiresAt).getTime() < Date.now()) {
          validationFailure = { ok: false, fieldErrors: { token: ["La invitación expiró"] } }
          throw new RegistrationRollback()
        }
        if (invitation.email !== data.email) {
          validationFailure = { ok: false, fieldErrors: { email: ["El correo no coincide con la invitación"] } }
          throw new RegistrationRollback()
        }

        roleIds = safeParseJson<string[]>(invitation.roleIdsJson, [])
        worksiteAssignments = safeParseJson<WorksiteAssignment[]>(invitation.worksiteAssignmentsJson, [])
        invitationId = invitation.id
      }

      if (existing) {
        // Usuario pre-creado por admin: solo actualizar credenciales.
        // Los roles y faenas ya fueron definidos por el admin al crear el usuario.
        await tx.update(users).set({
          name: data.name,
          hashedPassword,
          avatarColor,
          isActive: true,
          updatedAt: new Date().toISOString(),
        }).where(eq(users.id, existing.id))
      } else {
        // Nuevo usuario desde invitación: crear registro y aplicar asignaciones.
        await tx.insert(users).values({
          id,
          name: data.name,
          email: data.email,
          hashedPassword,
          avatarColor,
          isActive: true,
        })

        await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId })))

        if (worksiteAssignments.length > 0) {
          await tx.insert(worksiteUsers).values(
            worksiteAssignments.map((assignment) => ({
              userId: id,
              worksiteId: assignment.worksiteId,
              isPrimary: assignment.isPrimary,
            })),
          )
        }
      }

      if (invitationId) {
        await tx
          .update(userInvitations)
          .set({ acceptedAt: new Date().toISOString() })
          .where(eq(userInvitations.id, invitationId))
      }
    })
  } catch (err) {
    if (err instanceof RegistrationRollback && validationFailure) {
      await recordFailure(ipRateKey)
      await recordFailure(emailRateKey)
      return validationFailure
    }
    logger.error("[registerUser]", err)
    return { ok: false, message: "No se pudo completar el registro" }
  }

  await recordSuccess(ipRateKey)
  await recordSuccess(emailRateKey)
  return {
    ok: true,
    message: isBootstrap
      ? "Administrador creado. Ya puedes iniciar sesión."
      : "Cuenta creada. Ya puedes iniciar sesión.",
  }
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return h
}
