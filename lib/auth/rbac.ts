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

// Security audit S-03: keep cache TTL short (5s). Admin role/permission
// mutations always call clearUserRbacCache(userId) immediately, which
// collapses the window from up to 60s to effectively zero for the
// instance that handled the mutation. For other replicas behind a
// load balancer, the worst-case window is the TTL.
const RBAC_CACHE_TTL_MS = 5_000

// Security audit S-13: cap the cache so it can't grow without bound on an
// instance that sees many distinct users. Map preserves insertion order, so
// eviction drops expired entries first and then the oldest survivors.
const RBAC_CACHE_MAX_ENTRIES = 1_000

const rbacCache = new Map<string, { snapshot: UserRbacSnapshot | null; expiresAt: number }>()

function setRbacCache(userId: string, entry: { snapshot: UserRbacSnapshot | null; expiresAt: number }) {
  // Re-insert so this key becomes the most-recently-added (LRU-ish order).
  rbacCache.delete(userId)
  rbacCache.set(userId, entry)
  if (rbacCache.size <= RBAC_CACHE_MAX_ENTRIES) return

  const now = Date.now()
  for (const [key, value] of rbacCache) {
    if (rbacCache.size <= RBAC_CACHE_MAX_ENTRIES) break
    if (key === userId) continue // never evict the entry we just set
    if (value.expiresAt <= now) rbacCache.delete(key)
  }
  // Still over budget after dropping expired entries → drop oldest survivors.
  for (const key of rbacCache.keys()) {
    if (rbacCache.size <= RBAC_CACHE_MAX_ENTRIES) break
    if (key === userId) continue
    rbacCache.delete(key)
  }
}

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

  // Security audit A-05: fire all four independent reads in parallel.
  // The role→permissions query depends on user_roles' roleIds, but we
  // build a two-stage promise: userRoles/direct/worksites run together,
  // and once userRoles resolves we issue rolePermissions in a chained
  // .then. The total round-trip cost drops from (1+1+1+1) to (1+1).
  const userRoleRowsPromise = db
    .select({ roleId: userRoles.roleId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id))

  const directPermissionRowsPromise = db
    .select({ permissionName: permissions.name })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, user.id))

  const worksiteRowsPromise = db
    .select({ worksiteId: worksiteUsers.worksiteId, isPrimary: worksiteUsers.isPrimary })
    .from(worksiteUsers)
    .where(eq(worksiteUsers.userId, user.id))

  const rolePermissionRowsPromise = userRoleRowsPromise.then((userRoleRows) => {
    const roleIds = userRoleRows.map((r) => r.roleId)
    if (roleIds.length === 0) return []
    return db
      .select({ permissionName: permissions.name })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds))
  })

  const [userRoleRows, rolePermissionRows, directPermissionRows, wsRows] = await Promise.all([
    userRoleRowsPromise,
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

  setRbacCache(userId, { snapshot, expiresAt: Date.now() + RBAC_CACHE_TTL_MS })
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
