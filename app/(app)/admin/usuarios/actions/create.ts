"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, userPermissions, worksiteUsers, userInvitations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { clearUserRbacCache } from "@/lib/auth/rbac"
import { createPendingPasswordMarker, displayNameFromEmail } from "@/lib/auth/password-setup"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import { userCreateSchema, type ActionState } from "@/lib/validation/masters"
import {
  buildWorksiteAssignments,
  validateWorksiteAssignmentScope,
  validateRoleWorksiteRules,
  validatePermissionRules,
  canManageAdministratorRole,
  uniqueIds,
  hashStr,
} from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para crear usuarios" }

  const raw = {
    name:     formData.get("name") || "",
    email:    formData.get("email"),
    isActive: formData.get("isActive") === "on",
    roleIds:  formData.getAll("roleIds"),
    permissionIds: formData.getAll("permissionIds"),
    expiresInDays: formData.get("expiresInDays") || 7,
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const permissionIds = uniqueIds(d.permissionIds)
  const worksiteScopeError = validateWorksiteAssignmentScope(session, d.worksiteAssignments)
  if (worksiteScopeError) return worksiteScopeError
  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    canManageAdministratorRole(session),
  )
  if (roleError) return roleError
  const permissionError = await validatePermissionRules(permissionIds, canManageAdministratorRole(session))
  if (permissionError) return permissionError

  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const id           = nanoid()
  const displayName  = d.name?.trim() || displayNameFromEmail(d.email)
  const avatarColor  = String(Math.abs(hashStr(displayName)) % 360)
  const token        = generateInvitationToken()
  const inviteUrl    = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(token)}`
  const expiresAt    = new Date(Date.now() + d.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const invitationId = nanoid()

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id, name: displayName, email: d.email,
      hashedPassword: createPendingPasswordMarker(),
      avatarColor,
      isActive: d.isActive,
    })
    if (d.roleIds.length > 0) {
      await tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: id, roleId: rid })))
    }
    if (permissionIds.length > 0) {
      await tx.insert(userPermissions).values(permissionIds.map((pid) => ({ userId: id, permissionId: pid })))
    }
    if (d.worksiteAssignments.length > 0) {
      await tx.insert(worksiteUsers).values(
        d.worksiteAssignments.map((a) => ({
          userId: id, worksiteId: a.worksiteId, isPrimary: a.isPrimary,
        }))
      )
    }
    await tx.update(userInvitations)
      .set({ acceptedAt: new Date().toISOString() })
      .where(and(
        eq(userInvitations.email, d.email),
        isNull(userInvitations.acceptedAt),
      ))

    await tx.insert(userInvitations).values({
      id: invitationId,
      email: d.email,
      name: displayName,
      tokenHash: hashInvitationToken(token),
      roleIdsJson: JSON.stringify(d.roleIds),
      worksiteAssignmentsJson: JSON.stringify(d.worksiteAssignments),
      invitedByUserId: session.user.id,
      expiresAt,
    })
  })

  let deliveryMessage = `Usuario ${displayName} creado. Invitación enviada para definir contraseña.`
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: d.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (!delivery.sent) {
      deliveryMessage = `Usuario ${displayName} creado. SMTP no está configurado; comparte el enlace de registro.`
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido"
    deliveryMessage = `Usuario ${displayName} creado, pero no se pudo enviar la invitación (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user", entityId: id,
    newState: { name: displayName, email: d.email, roles: d.roleIds, permissions: permissionIds, passwordSetupPending: true, invitationId, smtpSent: !pendingInviteUrl },
  })

  clearUserRbacCache(id)
  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message: deliveryMessage,
    data: pendingInviteUrl ? { email: d.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}
