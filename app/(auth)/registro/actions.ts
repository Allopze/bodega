"use server"

import bcrypt from "bcryptjs"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { userInvitations, userRoles, users, worksiteUsers } from "@/db/schema"
import { ensureSystemRbac, getUserCount, hashInvitationToken } from "@/lib/auth/bootstrap"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { nanoid } from "@/lib/id"
import { registerUserSchema, type ActionState } from "@/lib/validation/masters"

type WorksiteAssignment = { worksiteId: string; isPrimary: boolean }

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
  const userCount = await getUserCount()
  const existing = await db.query.users.findFirst({ where: eq(users.email, data.email) })
  const existingCanCompleteSetup = existing ? isPasswordSetupPending(existing.hashedPassword) : false
  if (existing && !existingCanCompleteSetup) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  let roleIds = ["rol-admin"]
  let worksiteAssignments: WorksiteAssignment[] = []
  let invitationId: string | null = null

  if (userCount === 0) {
    await ensureSystemRbac()
  } else {
    if (!data.token) {
      return { ok: false, fieldErrors: { token: ["Necesitas una invitación para registrarte"] } }
    }

    const invitation = await db.query.userInvitations.findFirst({
      where: and(
        eq(userInvitations.tokenHash, hashInvitationToken(data.token)),
        isNull(userInvitations.acceptedAt),
      ),
    })

    if (!invitation) {
      return { ok: false, fieldErrors: { token: ["Invitación inválida o ya utilizada"] } }
    }
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      return { ok: false, fieldErrors: { token: ["La invitación expiró"] } }
    }
    if (invitation.email !== data.email) {
      return { ok: false, fieldErrors: { email: ["El correo no coincide con la invitación"] } }
    }

    roleIds = safeParseJson<string[]>(invitation.roleIdsJson, [])
    worksiteAssignments = safeParseJson<WorksiteAssignment[]>(invitation.worksiteAssignmentsJson, [])
    invitationId = invitation.id
  }

  const id = existing?.id ?? nanoid()
  const hashedPassword = await bcrypt.hash(data.password, 12)
  const avatarColor = existing?.avatarColor ?? String(Math.abs(hashStr(data.name)) % 360)

  db.transaction((tx) => {
    if (existing) {
      tx.update(users).set({
        name: data.name,
        hashedPassword,
        avatarColor,
        isActive: true,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, existing.id)).run()
      tx.delete(userRoles).where(eq(userRoles.userId, existing.id)).run()
      tx.delete(worksiteUsers).where(eq(worksiteUsers.userId, existing.id)).run()
    } else {
      tx.insert(users).values({
        id,
        name: data.name,
        email: data.email,
        hashedPassword,
        avatarColor,
        isActive: true,
      }).run()
    }

    tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId }))).run()

    if (worksiteAssignments.length > 0) {
      tx.insert(worksiteUsers).values(
        worksiteAssignments.map((assignment) => ({
          userId: id,
          worksiteId: assignment.worksiteId,
          isPrimary: assignment.isPrimary,
        })),
      ).run()
    }

    if (invitationId) {
      tx
        .update(userInvitations)
        .set({ acceptedAt: new Date().toISOString() })
        .where(eq(userInvitations.id, invitationId))
        .run()
    }
  })

  return {
    ok: true,
    message: userCount === 0
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
