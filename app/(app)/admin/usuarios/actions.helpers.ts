/**
 * Shared helpers for user management Server Actions.
 *
 * Extracted from actions.ts to reduce file size and enable reuse.
 */

import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { userRoles, roles, permissions } from "@/db/schema"
import { canAccessWorksite, can } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/masters"

// ── Worksite assignments ──────────────────────────────────────────────────────

export function buildWorksiteAssignments(formData: FormData) {
  const selectedIds      = formData.getAll("worksiteId") as string[]
  const primaryWorksiteId = formData.get("primaryWorksiteId") as string | null
  return selectedIds.map((wsId) => ({
    worksiteId: wsId,
    isPrimary:  wsId === primaryWorksiteId,
  }))
}

// ── Scope guard ───────────────────────────────────────────────────────────────

export function validateWorksiteAssignmentScope(
  session: Session,
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[],
): ActionState | null {
  const outOfScope = worksiteAssignments.some(
    (a) => !canAccessWorksite(session, a.worksiteId),
  )
  if (!outOfScope) return null
  return {
    ok: false,
    fieldErrors: {
      worksiteAssignments: ["Solo puedes asignar faenas dentro de tu alcance"],
    },
  }
}

// ── Role rules ────────────────────────────────────────────────────────────────

export async function validateRoleWorksiteRules(
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
  const FAENA_SCOPED_ROLES = ["solicitante_faena", "prevencionista_faena", "conductor_lider"]
  const isFaenaScoped = selected.some((role) => FAENA_SCOPED_ROLES.includes(role.name))
  if (isFaenaScoped && worksiteAssignments.length === 0) {
    return {
      ok: false,
      fieldErrors: {
        worksiteAssignments: ["Este rol de faena debe tener al menos una faena asignada"],
      },
    }
  }
  return null
}

// ── Permission rules ──────────────────────────────────────────────────────────

export async function validatePermissionRules(
  permissionIds: string[],
  canManageAdminPermissions = false,
): Promise<ActionState | null> {
  const uniqueIds = [...new Set(permissionIds)]
  if (uniqueIds.length === 0) return null

  const selected = await db.query.permissions.findMany({
    where: inArray(permissions.id, uniqueIds),
  })
  if (selected.length !== uniqueIds.length) {
    return {
      ok: false,
      fieldErrors: {
        permissionIds: ["Uno o más permisos seleccionados no existen"],
      },
    }
  }

  const includesAdminPermission = selected.some((p) => p.module === "admin")
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

// ── Admin guard ───────────────────────────────────────────────────────────────

export function canManageAdministratorRole(session: Session) {
  return can(session, "admin:manage_admins")
}

export function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter((id) => id.length > 0))]
}

export async function userHasAdministratorRole(userId: string) {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.name, "administrador"), eq(userRoles.userId, userId)))
  return rows.length > 0
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return h
}
