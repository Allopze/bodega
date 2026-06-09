import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, roles, rolePermissions, permissions, worksiteUsers } from "@/db/schema"

export interface UserRbacSnapshot {
  id: string
  name: string
  email: string
  avatarColor: string | null
  isActive: boolean
  roles: string[]
  permissions: string[]
  worksiteIds: string[]
  primaryWorksiteId: string | null
}

const rbacCache = new Map<string, { snapshot: UserRbacSnapshot | null; expiresAt: number }>()

export async function getUserRbacById(
  userId: string,
  bypassCache = false,
): Promise<UserRbacSnapshot | null> {
  if (!bypassCache) {
    const cached = rbacCache.get(userId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot
    }
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!user) return null

  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id))

  const roleIds = userRoleRows.map((r) => r.roleId)

  let permissionNames: string[] = []
  if (roleIds.length > 0) {
    const permsRows = await db
      .select({ permissionName: permissions.name })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds))
    permissionNames = [...new Set(permsRows.map((p) => p.permissionName))]
  }

  const wsRows = await db
    .select({ worksiteId: worksiteUsers.worksiteId, isPrimary: worksiteUsers.isPrimary })
    .from(worksiteUsers)
    .where(eq(worksiteUsers.userId, user.id))

  const snapshot = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
    roles: userRoleRows.map((r) => r.roleName),
    permissions: permissionNames,
    worksiteIds: wsRows.map((w) => w.worksiteId),
    primaryWorksiteId: wsRows.find((w) => w.isPrimary)?.worksiteId ?? wsRows[0]?.worksiteId ?? null,
  }

  rbacCache.set(userId, { snapshot, expiresAt: Date.now() + 60000 })
  return snapshot
}

export function applyRbacToToken(
  token: Record<string, unknown>,
  snapshot: UserRbacSnapshot | null,
) {
  if (!snapshot || !snapshot.isActive) {
    token.roles = []
    token.permissions = []
    token.worksiteIds = []
    token.primaryWorksiteId = null
    token.avatarColor = null
    token.isActive = false
    return token
  }

  token.id = snapshot.id
  token.name = snapshot.name
  token.email = snapshot.email
  token.roles = snapshot.roles
  token.permissions = snapshot.permissions
  token.worksiteIds = snapshot.worksiteIds
  token.primaryWorksiteId = snapshot.primaryWorksiteId
  token.avatarColor = snapshot.avatarColor
  token.isActive = true
  return token
}
