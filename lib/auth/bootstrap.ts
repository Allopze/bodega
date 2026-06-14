import { createHash, randomBytes } from "crypto"
import { count, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { permissions, rolePermissions, roles, users } from "@/db/schema"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

export { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

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
