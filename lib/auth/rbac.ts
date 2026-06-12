import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { users, userRoles, roles, rolePermissions, permissions, userPermissions, worksiteUsers } from "@/db/schema"

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

  const rolePermissionRowsPromise = roleIds.length > 0
    ? db
      .select({ permissionName: permissions.name })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds))
    : Promise.resolve([])

  const directPermissionRowsPromise = db
    .select({ permissionName: permissions.name })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, user.id))

  const worksiteRowsPromise = db
    .select({ worksiteId: worksiteUsers.worksiteId, isPrimary: worksiteUsers.isPrimary })
    .from(worksiteUsers)
    .where(eq(worksiteUsers.userId, user.id))

  const [rolePermissionRows, directPermissionRows, wsRows] = await Promise.all([
    rolePermissionRowsPromise,
    directPermissionRowsPromise,
    worksiteRowsPromise,
  ])

  const permissionNames = [
    ...new Set([
      ...rolePermissionRows.map((p) => p.permissionName),
      ...directPermissionRows.map((p) => p.permissionName),
    ]),
  ]

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

export function clearUserRbacCache(userId: string) {
  rbacCache.delete(userId)
}
