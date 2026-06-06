"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users, userRoles, worksiteUsers, roles } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { userCreateSchema, userUpdateSchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/usuarios"

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

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id, name: d.name, email: d.email,
      hashedPassword: hashedPass,
      avatarColor,
      isActive: d.isActive,
    })
    if (d.roleIds.length > 0) {
      await tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: id, roleId: rid })))
    }
    if (d.worksiteAssignments.length > 0) {
      await tx.insert(worksiteUsers).values(
        d.worksiteAssignments.map((a) => ({
          userId: id, worksiteId: a.worksiteId, isPrimary: a.isPrimary,
        }))
      )
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

  await db.transaction(async (tx) => {
    await tx.update(users).set(updates).where(eq(users.id, d.id))
    // Replace roles
    await tx.delete(userRoles).where(eq(userRoles.userId, d.id))
    if (d.roleIds.length > 0) {
      await tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: d.id, roleId: rid })))
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
