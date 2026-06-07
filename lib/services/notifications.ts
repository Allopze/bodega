/**
 * In-app notification service.
 *
 * Notifications are created by server actions and services at key lifecycle points.
 * They are consumed by the NotificationBell component via /api/notifications.
 *
 * Design: fire-and-forget — notification creation never blocks the main action.
 * Callers wrap in try/catch or use the safe `notifySafe()` helper.
 */

import { eq, and, desc } from "drizzle-orm"
import { db } from "@/db"
import { notifications, rolePermissions, permissions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { NotificationType } from "@/db/schema/audit"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface CreateNotificationInput {
  userId:     string
  type:       NotificationType
  title:      string
  body?:      string
  entityType?: string
  entityId?:  string
  entityHref?: string
}

/* ── Core ────────────────────────────────────────────────────────────────────── */

/**
 * Creates a single notification for a user. Throws on DB error.
 * Prefer `notifySafe()` in server actions to avoid blocking on errors.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await db.insert(notifications).values({
    id:         nanoid(),
    userId:     input.userId,
    type:       input.type,
    title:      input.title,
    body:       input.body ?? null,
    entityType: input.entityType ?? null,
    entityId:   input.entityId ?? null,
    entityHref: input.entityHref ?? null,
    isRead:     false,
  })
}

/**
 * Creates notifications for multiple users. Throws on DB error.
 */
export async function createNotifications(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  if (userIds.length === 0) return
  await db.insert(notifications).values(
    userIds.map((userId) => ({
      id:         nanoid(),
      userId,
      type:       input.type,
      title:      input.title,
      body:       input.body ?? null,
      entityType: input.entityType ?? null,
      entityId:   input.entityId ?? null,
      entityHref: input.entityHref ?? null,
      isRead:     false,
    })),
  )
}

/**
 * Fire-and-forget wrapper — logs errors but does NOT throw.
 * Use in server actions so notification failures never break the main flow.
 */
export async function notifySafe(input: CreateNotificationInput): Promise<void> {
  try { await createNotification(input) }
  catch (err) { console.error("[notifications] failed to create notification", err) }
}

export async function notifyManyUser(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  try { await createNotifications(userIds, input) }
  catch (err) { console.error("[notifications] failed to create notifications", err) }
}

/* ── Permission-based targeting ──────────────────────────────────────────────── */

/**
 * Returns user IDs who have at least one of the given permissions.
 * Used to notify approvers, warehouse staff, etc.
 */
export async function getUserIdsWithPermission(permissionName: string): Promise<string[]> {
  // Find permission id
  const perm = await db.query.permissions.findFirst({
    where: eq(permissions.name, permissionName),
  })
  if (!perm) return []

  // Find roles with that permission
  const rolePerm = await db.query.rolePermissions.findMany({
    where: eq(rolePermissions.permissionId, perm.id),
  })
  if (rolePerm.length === 0) return []

  const roleIds = rolePerm.map((rp) => rp.roleId)

  // Find users with those roles
  const userRole = await db.query.userRoles.findMany({
    where: (ur, { inArray }) => inArray(ur.roleId, roleIds),
  })
  return [...new Set(userRole.map((ur) => ur.userId))]
}

/* ── Read/mark read ──────────────────────────────────────────────────────────── */

export interface NotificationRow {
  id:         string
  type:       string
  title:      string
  body:       string | null
  entityHref: string | null
  isRead:     boolean
  createdAt:  string
}

export async function getNotificationsForUser(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const rows = await db.query.notifications.findMany({
    where:   eq(notifications.userId, userId),
    orderBy: desc(notifications.createdAt),
    limit,
  })
  return rows.map((n) => ({
    id:         n.id,
    type:       n.type,
    title:      n.title,
    body:       n.body,
    entityHref: n.entityHref,
    isRead:     n.isRead,
    createdAt:  n.createdAt,
  }))
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ),
    columns: { id: true },
  })
  return rows.length
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
}
