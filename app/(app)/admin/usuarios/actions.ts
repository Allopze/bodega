"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users, userRoles, worksiteUsers, roles, userInvitations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
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
  const roleError = await validateRoleWorksiteRules(d.roleIds, d.worksiteAssignments)
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
  try {
    const delivery = await sendInvitationEmail({
      to: d.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    deliveryMessage = delivery.sent
      ? `Invitación enviada a ${d.email}`
      : `Invitación creada. SMTP no configurado, enlace: ${inviteUrl}`
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido"
    deliveryMessage = `Invitación creada, pero no se pudo enviar el correo (${reason}). Enlace: ${inviteUrl}`
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user_invitation", entityId: invitationId,
    newState: { email: d.email, roles: d.roleIds, expiresAt },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: deliveryMessage }
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
    name:     formData.get("name"),
    email:    formData.get("email"),
    password: formData.get("password"),
    isActive: formData.get("isActive") === "on",
    roleIds:  formData.getAll("roleIds"),
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const roleError = await validateRoleWorksiteRules(d.roleIds, d.worksiteAssignments)
  if (roleError) return roleError

  // Check email uniqueness
  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const id           = nanoid()
  const hashedPass   = await bcrypt.hash(d.password, 10)
  const avatarColor  = String(Math.abs(hashStr(d.name)) % 360)

  db.transaction((tx) => {
    tx.insert(users).values({
      id, name: d.name, email: d.email,
      hashedPassword: hashedPass,
      avatarColor,
      isActive: d.isActive,
    }).run()
    if (d.roleIds.length > 0) {
      tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: id, roleId: rid }))).run()
    }
    if (d.worksiteAssignments.length > 0) {
      tx.insert(worksiteUsers).values(
        d.worksiteAssignments.map((a) => ({
          userId: id, worksiteId: a.worksiteId, isPrimary: a.isPrimary,
        }))
      ).run()
    }
  })

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user", entityId: id,
    newState: { name: d.name, email: d.email, roles: d.roleIds },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Usuario ${d.name} creado` }
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
    password: formData.get("password") || "",
    isActive: formData.get("isActive") === "on",
    roleIds:  formData.getAll("roleIds"),
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const roleError = await validateRoleWorksiteRules(d.roleIds, d.worksiteAssignments)
  if (roleError) return roleError

  // Check email uniqueness (excluding self)
  const emailConflict = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (emailConflict && emailConflict.id !== d.id) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  // Load current state for audit diff
  const current = await db.query.users.findFirst({ where: eq(users.id, d.id) })
  if (!current) return { ok: false, message: "Usuario no encontrado" }

  const updates: Partial<typeof users.$inferInsert> = {
    name:     d.name,
    email:    d.email,
    isActive: d.isActive,
    updatedAt: new Date().toISOString(),
  }
  if (d.password) {
    updates.hashedPassword = await bcrypt.hash(d.password, 10)
  }

  db.transaction((tx) => {
    tx.update(users).set(updates).where(eq(users.id, d.id)).run()
    // Replace roles
    tx.delete(userRoles).where(eq(userRoles.userId, d.id)).run()
    if (d.roleIds.length > 0) {
      tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: d.id, roleId: rid }))).run()
    }
    // Replace worksite assignments
    tx.delete(worksiteUsers).where(eq(worksiteUsers.userId, d.id)).run()
    if (d.worksiteAssignments.length > 0) {
      tx.insert(worksiteUsers).values(
        d.worksiteAssignments.map((a) => ({
          userId: d.id, worksiteId: a.worksiteId, isPrimary: a.isPrimary,
        }))
      ).run()
    }
  })

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "user", entityId: d.id,
    oldState: { name: current.name, email: current.email, isActive: current.isActive },
    newState: { name: d.name, email: d.email, isActive: d.isActive, roles: d.roleIds },
  })

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

  // Guard: don't deactivate the last admin
  if (!activate) {
    const activeAdmins = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(roles.name, "administrador"))
    const otherActiveAdmins = activeAdmins.filter((r) => r.userId !== id)
    const isAdmin = activeAdmins.some((r) => r.userId === id)
    if (isAdmin && otherActiveAdmins.length === 0) {
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
): Promise<ActionState | null> {
  const allRoles = await db.query.roles.findMany()
  const selected = allRoles.filter((role) => roleIds.includes(role.id))
  const isFaenaRequester = selected.some((role) => role.name === "solicitante_faena")
  if (isFaenaRequester && worksiteAssignments.length === 0) {
    return {
      ok: false,
      fieldErrors: {
        worksiteAssignments: ["El solicitante de faena debe tener al menos una faena asignada"],
      },
    }
  }
  return null
}

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return h
}
