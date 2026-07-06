"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, userPermissions, worksiteUsers } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { clearUserRbacCache } from "@/lib/auth/rbac"
import { canManageUserInAdminScope } from "@/lib/auth/admin-user-scope"
import { userUpdateSchema, type ActionState } from "@/lib/validation/masters"
import {
  buildWorksiteAssignments,
  validateWorksiteAssignmentScope,
  validateRoleWorksiteRules,
  validatePermissionRules,
  canManageAdministratorRole,
  uniqueIds,
  userHasAdministratorRole,
} from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function updateUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos" }

  const raw = {
    id:       formData.get("id"),
    name:     formData.get("name"),
    email:    formData.get("email"),
    isActive: formData.get("isActive") === "on",
    emailNotifications: formData.get("emailNotifications") === "on",
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
  const current = await db.query.users.findFirst({ where: eq(users.id, d.id) })
  if (!current) return { ok: false, message: "Usuario no encontrado" }
  if (!await canManageUserInAdminScope(db, session, d.id)) {
    return { ok: false, message: "No tienes acceso para modificar este usuario" }
  }

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
  const worksiteScopeError = validateWorksiteAssignmentScope(session, d.worksiteAssignments)
  if (worksiteScopeError) return worksiteScopeError
  const permissionError = await validatePermissionRules(permissionIds, actorCanManageAdmins)
  if (permissionError) return permissionError

  const emailConflict = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (emailConflict && emailConflict.id !== d.id) {
    return { ok: false, fieldErrors: { email: ["Este correo ya está registrado"] } }
  }

  const updates: Partial<typeof users.$inferInsert> = {
    name:     d.name,
    email:    d.email,
    isActive: d.isActive,
    emailNotifications: d.emailNotifications,
    updatedAt: new Date().toISOString(),
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set(updates).where(eq(users.id, d.id))
    await tx.delete(userRoles).where(eq(userRoles.userId, d.id))
    if (d.roleIds.length > 0) {
      await tx.insert(userRoles).values(d.roleIds.map((rid) => ({ userId: d.id, roleId: rid })))
    }
    await tx.delete(userPermissions).where(eq(userPermissions.userId, d.id))
    if (permissionIds.length > 0) {
      await tx.insert(userPermissions).values(permissionIds.map((pid) => ({ userId: d.id, permissionId: pid })))
    }
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
    oldState: { name: current.name, email: current.email, isActive: current.isActive, emailNotifications: current.emailNotifications },
    newState: { name: d.name, email: d.email, isActive: d.isActive, emailNotifications: d.emailNotifications, roles: d.roleIds, permissions: permissionIds },
  })

  clearUserRbacCache(d.id)
  revalidatePath(REVALIDATE)
  return { ok: true, message: `Usuario ${d.name} actualizado` }
}
