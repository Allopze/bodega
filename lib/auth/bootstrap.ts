import { createHash, randomBytes } from "crypto"
import { count, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, users } from "@/db/schema"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

export { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

/** Permissions removed from the registry that must not survive in direct grants. */
const RETIRED_PERMISSION_NAMES = [
  "prevention:pdtp:manage",
  "requests:submit",
  "operations:assign_work",
  "traceability:view",
  "traceability:reconcile_integrity",
] as const

/**
 * Idempotently seeds system roles/permissions. Accepts an optional transaction
 * executor so callers (e.g. the bootstrap registration) can run it atomically
 * within their own transaction — passing `tx` also avoids re-entering the
 * connection on single-connection setups (pglite tests).
 */
export async function ensureSystemRbac(executor: typeof db | Tx = db) {
  for (const role of SYSTEM_ROLES) {
    await executor.insert(roles).values(role).onConflictDoUpdate({
      target: roles.id,
      set: {
        name: role.name,
        label: role.label,
        description: role.description ?? null,
      },
    })
  }

  for (const permission of SYSTEM_PERMISSIONS) {
    await executor.insert(permissions).values(permission).onConflictDoUpdate({
      target: permissions.id,
      set: {
        name: permission.name,
        module: permission.module,
        description: permission.description ?? null,
      },
    })
  }

  // System role grants are rebuilt below, but direct user grants can otherwise
  // keep a retired permission alive indefinitely. Remove every reference before
  // deleting its permission record so the normal RBAC sync is a full retirement.
  const retiredPermissions = await executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.name, [...RETIRED_PERMISSION_NAMES]))
  const retiredPermissionIds = retiredPermissions.map((permission) => permission.id)
  if (retiredPermissionIds.length > 0) {
    await executor.delete(userPermissions).where(inArray(userPermissions.permissionId, retiredPermissionIds))
    await executor.delete(rolePermissions).where(inArray(rolePermissions.permissionId, retiredPermissionIds))
    await executor.delete(permissions).where(inArray(permissions.id, retiredPermissionIds))
  }

  await executor.delete(rolePermissions).where(inArray(rolePermissions.roleId, SYSTEM_ROLES.map((role) => role.id)))
  await executor.insert(rolePermissions).values(SYSTEM_ROLE_PERMISSIONS)
}

export async function getUserCount() {
  const [row] = await db.select({ value: count() }).from(users)
  return row?.value ?? 0
}

export function generateInvitationToken() {
  return randomBytes(32).toString("base64url")
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
