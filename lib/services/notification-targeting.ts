/**
 * Permission-based notification targeting.
 * Resolves which users should receive a notification based on their roles/permissions.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles, users, worksiteUsers } from "@/db/schema"

/**
 * Returns user IDs who have at least one of the given permissions.
 * Considers both role-based grants and direct user-permission grants.
 */
export async function getUserIdsWithPermission(permissionName: string): Promise<string[]> {
  const perm = await db.query.permissions.findFirst({
    where: eq(permissions.name, permissionName),
  })
  if (!perm) return []

  const userIds = new Set<string>()

  // Users with the permission via roles
  const rolePerm = await db.query.rolePermissions.findMany({
    where: eq(rolePermissions.permissionId, perm.id),
  })
  if (rolePerm.length > 0) {
    const roleIds = rolePerm.map((rp) => rp.roleId)
    const userRole = await db.query.userRoles.findMany({
      where: (ur, { inArray }) => inArray(ur.roleId, roleIds),
    })
    const roleUserIds = [...new Set(userRole.map((ur) => ur.userId))]
    if (roleUserIds.length > 0) {
      const activeRoleUsers = await db.query.users.findMany({
        where: (u, { and, inArray }) => and(
          inArray(u.id, roleUserIds),
          eq(u.isActive, true),
        ),
        columns: { id: true },
      })
      for (const u of activeRoleUsers) userIds.add(u.id)
    }
  }

  // Users with direct permission grants (userPermissions table)
  const directGrants = await db.query.userPermissions.findMany({
    where: eq(userPermissions.permissionId, perm.id),
  })
  if (directGrants.length > 0) {
    const directUserIds = [...new Set(directGrants.map((up) => up.userId))]
    const activeDirect = await db.query.users.findMany({
      where: (u, { and, inArray }) => and(
        inArray(u.id, directUserIds),
        eq(u.isActive, true),
      ),
      columns: { id: true },
    })
    for (const u of activeDirect) userIds.add(u.id)
  }

  return [...userIds]
}

/**
 * Returns user IDs who have the given permission AND are scoped to a specific worksite.
 */
export async function getUserIdsWithPermissionForWorksite(
  permissionName: string,
  worksiteId: string,
): Promise<string[]> {
  if (!worksiteId) return []

  const candidateIds = await getUserIdsWithPermission(permissionName)
  if (candidateIds.length === 0) return []

  const activeScopeRows = await db
    .select({
      userId: users.id,
      assignedWorksiteId: worksiteUsers.worksiteId,
    })
    .from(users)
    .leftJoin(
      worksiteUsers,
      and(
        eq(worksiteUsers.userId, users.id),
        eq(worksiteUsers.worksiteId, worksiteId),
      ),
    )
    .where(and(
      inArray(users.id, candidateIds),
      eq(users.isActive, true),
    ))

  const globalRoleRows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      inArray(userRoles.userId, candidateIds),
      eq(roles.isGlobal, true),
    ))

  const globalUserIds = new Set(globalRoleRows.map((row) => row.userId))

  return [...new Set(
    activeScopeRows
      .filter((row) => globalUserIds.has(row.userId) || row.assignedWorksiteId === worksiteId)
      .map((row) => row.userId)
  )]
}
