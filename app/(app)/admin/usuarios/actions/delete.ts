"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { roles, userRoles, users } from "@/db/schema"
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

function isForeignKeyViolation(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && (error as { code?: string }).code === "23503") return true
  if ("cause" in error) return isForeignKeyViolation((error as { cause?: unknown }).cause)
  return false
}

export async function deleteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos" }

  const id = formData.get("id") as string
  if (!id) return { ok: false, message: "ID requerido" }
  if (id === session.user.id) {
    return { ok: false, message: "No puedes eliminar tu propia cuenta" }
  }

  const current = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!current) return { ok: false, message: "Usuario no encontrado" }

  if (!await canManageUserInAdminScope(db, session, id)) {
    return { ok: false, message: "No tienes acceso para eliminar este usuario" }
  }

  const targetIsAdmin = await userHasAdministratorRole(id)
  if (targetIsAdmin && !canManageAdministratorRole(session)) {
    return { ok: false, message: "Solo un administrador puede eliminar administradores" }
  }

  const LAST_ADMIN_LOCK_KEY = 521_113_337

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LAST_ADMIN_LOCK_KEY})`)

      if (targetIsAdmin && current.isActive) {
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

      await tx.delete(users).where(eq(users.id, id))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "delete",
        entityType: "user",
        entityId: id,
        oldState: {
          name: current.name,
          email: current.email,
          isActive: current.isActive,
        },
      }, tx)
    })
  } catch (err) {
    if (err instanceof LastAdminGuardError) {
      return { ok: false, message: "No puedes eliminar al único administrador activo" }
    }
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        message: "No se puede eliminar este usuario porque tiene historial asociado. Desactívalo para bloquear su acceso.",
      }
    }
    throw err
  }

  clearUserRbacCache(id)
  revalidatePath(REVALIDATE)
  return { ok: true, message: "Usuario eliminado" }
}
