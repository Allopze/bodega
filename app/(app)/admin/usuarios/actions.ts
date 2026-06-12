"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, userPermissions, worksiteUsers, roles, permissions, userInvitations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { clearUserRbacCache } from "@/lib/auth/rbac"
import { createPendingPasswordMarker, displayNameFromEmail } from "@/lib/auth/password-setup"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import { userCreateSchema, userInvitationSchema, userUpdateSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/usuarios"

// ── Invite ───────────────────────────────────────────────────────────────────
export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:users") }
  catch { return { ok: false, message: "Sin permisos para invitar usuarios" } }

  const raw = {
    name: formData.get("name") || "",
    email: formData.get("email"),
    roleIds: formData.getAll("roleIds"),
    expiresInDays: formData.get("expiresInDays") || 7,
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userInvitationSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    canManageAdministratorRole(session),
  )
  if (roleError) return roleError

  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya tiene una cuenta"] } }
  }

  const token = generateInvitationToken()
  const inviteUrl = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(token)}`
  const expiresAt = new Date(Date.now() + d.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const invitationId = nanoid()

  await db.insert(userInvitations).values({
    id: invitationId,
    email: d.email,
    name: d.name || null,
    tokenHash: hashInvitationToken(token),
    roleIdsJson: JSON.stringify(d.roleIds),
    worksiteAssignmentsJson: JSON.stringify(d.worksiteAssignments),
    invitedByUserId: session.user.id,
    expiresAt,
  })

  let deliveryMessage = "Invitación creada"
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: d.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (delivery.sent) {
      deliveryMessage = `Invitación enviada a ${d.email}`
    } else {
      // SMTP no está configurado: nunca mostramos el enlace crudo en el
      // toast (queda visible en la UI). Lo entregamos por un canal
      // separado (data.inviteUrl) para que el cliente lo presente
      // explícitamente con un botón "Copiar enlace" en una sheet de
      // confirmación, no en un toast efímero.
      deliveryMessage = `Invitación creada. SMTP no está configurado; revisa la invitación pendiente.`
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido"
    deliveryMessage = `Invitación creada, pero no se pudo enviar el correo (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user_invitation", entityId: invitationId,
    newState: { email: d.email, roles: d.roleIds, expiresAt, smtpSent: !pendingInviteUrl },
  })

  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message: deliveryMessage,
    data: pendingInviteUrl ? { email: d.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}

// ── Create ────────────────────────────────────────────────────────────────────
export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:users") }
  catch { return { ok: false, message: "Sin permisos para crear usuarios" } }

  const raw = {
    name:     formData.get("name") || "",
    email:    formData.get("email"),
    isActive: formData.get("isActive") === "on",
    roleIds:  formData.getAll("roleIds"),
    permissionIds: formData.getAll("permissionIds"),
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const permissionIds = uniqueIds(d.permissionIds)
  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    canManageAdministratorRole(session),
  )
  if (roleError) return roleError
  const permissionError = await validatePermissionRules(permissionIds, canManageAdministratorRole(session))
  if (permissionError) return permissionError

  // Check email uniqueness
  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const id           = nanoid()
  const displayName  = d.name?.trim() || displayNameFromEmail(d.email)
  const avatarColor  = String(Math.abs(hashStr(displayName)) % 360)
  const token        = generateInvitationToken()
  const inviteUrl    = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(token)}`
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
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

// ── Update ────────────────────────────────────────────────────────────────────
export async function updateUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:users") }
  catch { return { ok: false, message: "Sin permisos" } }

  const raw = {
    id:       formData.get("id"),
    name:     formData.get("name"),
    email:    formData.get("email"),
    isActive: formData.get("isActive") === "on",
    roleIds:  formData.getAll("roleIds"),
    permissionIds: formData.getAll("permissionIds"),
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const permissionIds = uniqueIds(d.permissionIds)
  // Load current state for audit diff
  const current = await db.query.users.findFirst({ where: eq(users.id, d.id) })
  if (!current) return { ok: false, message: "Usuario no encontrado" }

  const actorCanManageAdmins = canManageAdministratorRole(session)
  if (!actorCanManageAdmins && await userHasAdministratorRole(d.id)) {
    return { ok: false, message: "Solo un administrador puede modificar usuarios administradores" }
  }

  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    actorCanManageAdmins,
  )
  if (roleError) return roleError
  const permissionError = await validatePermissionRules(permissionIds, actorCanManageAdmins)
  if (permissionError) return permissionError

  // Check email uniqueness (excluding self)
  const emailConflict = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (emailConflict && emailConflict.id !== d.id) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const updates: Partial<typeof users.$inferInsert> = {
    name:     d.name,
    email:    d.email,
    isActive: d.isActive,
    updatedAt: new Date().toISOString(),
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set(updates).where(eq(users.id, d.id))
    // Replace roles
    await tx.delete(userRoles).where(eq(userRoles.userId, d.id))
    if (d.roleIds.length > 0) {
      await tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: d.id, roleId: rid })))
    }
    // Replace direct permission grants
    await tx.delete(userPermissions).where(eq(userPermissions.userId, d.id))
    if (permissionIds.length > 0) {
      await tx.insert(userPermissions).values(permissionIds.map((pid) => ({ userId: d.id, permissionId: pid })))
    }
    // Replace worksite assignments
    await tx.delete(worksiteUsers).where(eq(worksiteUsers.userId, d.id))
    if (d.worksiteAssignments.length > 0) {
      await tx.insert(worksiteUsers).values(
        d.worksiteAssignments.map((a) => ({
          userId: d.id, worksiteId: a.worksiteId, isPrimary: a.isPrimary,
        }))
      )
    }
  })

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "user", entityId: d.id,
    oldState: { name: current.name, email: current.email, isActive: current.isActive },
    newState: { name: d.name, email: d.email, isActive: d.isActive, roles: d.roleIds, permissions: permissionIds },
  })

  clearUserRbacCache(d.id)
  revalidatePath(REVALIDATE)
  return { ok: true, message: `Usuario ${d.name} actualizado` }
}

// ── Toggle active ─────────────────────────────────────────────────────────────
export async function toggleUserActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:users") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"

  if (!id) return { ok: false, message: "ID requerido" }

  const targetIsAdmin = await userHasAdministratorRole(id)
  if (targetIsAdmin && !canManageAdministratorRole(session)) {
    return { ok: false, message: "Solo un administrador puede activar o desactivar administradores" }
  }

  // Guard: don't deactivate the last admin
  if (!activate && targetIsAdmin) {
    const otherActiveAdmins = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(roles.name, "administrador"), eq(users.isActive, true), ne(users.id, id)))

    if (otherActiveAdmins.length === 0) {
      return { ok: false, message: "No puedes desactivar al único administrador" }
    }
  }

  await db.update(users).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(users.id, id))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "user", entityId: id,
    oldState: { isActive: !activate }, newState: { isActive: activate },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Usuario activado" : "Usuario desactivado" }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildWorksiteAssignments(formData: FormData) {
  const selectedIds      = formData.getAll("worksiteId") as string[]
  const primaryWorksiteId = formData.get("primaryWorksiteId") as string | null
  return selectedIds.map((wsId) => ({
    worksiteId: wsId,
    isPrimary:  wsId === primaryWorksiteId,
  }))
}

async function validateRoleWorksiteRules(
  roleIds: string[],
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[],
  canManageAdmins = false,
): Promise<ActionState | null> {
  const allRoles = await db.query.roles.findMany()
  const selected = allRoles.filter((role) => roleIds.includes(role.id))
  const includesAdmin = selected.some((role) => role.name === "administrador")
  if (includesAdmin && !canManageAdmins) {
    return {
      ok: false,
      fieldErrors: {
        roleIds: ["Solo un administrador puede asignar el rol Administrador"],
      },
    }
  }
  const isFaenaRequester = selected.some((role) => role.name === "solicitante_faena")
  if (isFaenaRequester && worksiteAssignments.length === 0) {
    return {
      ok: false,
      fieldErrors: {
        worksiteAssignments: ["El prevencionista faena debe tener al menos una faena asignada"],
      },
    }
  }
  return null
}

async function validatePermissionRules(
  permissionIds: string[],
  canManageAdminPermissions = false,
): Promise<ActionState | null> {
  const uniquePermissionIds = [...new Set(permissionIds)]
  if (uniquePermissionIds.length === 0) return null

  const selected = await db.query.permissions.findMany({
    where: inArray(permissions.id, uniquePermissionIds),
  })
  if (selected.length !== uniquePermissionIds.length) {
    return {
      ok: false,
      fieldErrors: {
        permissionIds: ["Uno o más permisos seleccionados no existen"],
      },
    }
  }

  const includesAdminPermission = selected.some((permission) => permission.module === "admin")
  if (includesAdminPermission && !canManageAdminPermissions) {
    return {
      ok: false,
      fieldErrors: {
        permissionIds: ["Solo un administrador puede asignar permisos de administración"],
      },
    }
  }

  return null
}

function canManageAdministratorRole(session: Session) {
  return session.user.roles.includes("administrador")
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter((id) => id.length > 0))]
}

async function userHasAdministratorRole(userId: string) {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.name, "administrador"), eq(userRoles.userId, userId)))
  return rows.length > 0
}

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return h
}
