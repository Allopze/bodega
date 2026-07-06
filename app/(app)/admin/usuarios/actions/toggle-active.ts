"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, roles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { clearUserRbacCache } from "@/lib/auth/rbac"
import { canManageUserInAdminScope } from "@/lib/auth/admin-user-scope"
import type { ActionState } from "@/lib/validation/masters"
import {
  canManageAdministratorRole,
  userHasAdministratorRole,
} from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

class LastAdminGuardError extends Error {}

export async function toggleUserActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos" }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"

  if (!id) return { ok: false, message: "ID requerido" }
  if (!await canManageUserInAdminScope(db, session, id)) {
    return { ok: false, message: "No tienes acceso para modificar este usuario" }
  }

  const targetIsAdmin = await userHasAdministratorRole(id)
  if (targetIsAdmin && !canManageAdministratorRole(session)) {
    return { ok: false, message: "Solo un administrador puede activar o desactivar administradores" }
  }

  const LAST_ADMIN_LOCK_KEY = 521_113_337

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LAST_ADMIN_LOCK_KEY})`)

      if (!activate && targetIsAdmin) {
        const otherActiveAdmins = await tx
          .select({ userId: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(and(eq(roles.name, "administrador"), eq(users.isActive, true), ne(users.id, id)))

        if (otherActiveAdmins.length === 0) {
          throw new LastAdminGuardError()
        }
      }

      await tx.update(users).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(users.id, id))
    })
  } catch (err) {
    if (err instanceof LastAdminGuardError) {
      return { ok: false, message: "No puedes desactivar al único administrador" }
    }
    throw err
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "user", entityId: id,
    oldState: { isActive: !activate }, newState: { isActive: activate },
  })

  clearUserRbacCache(id)
  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Usuario activado" : "Usuario desactivado" }
}
