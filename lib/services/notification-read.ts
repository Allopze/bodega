/**
 * Notification read and mark-as-read operations.
 */

import { eq, and, desc, sql, count } from "drizzle-orm"
import { db } from "@/db"
import { notifications, users } from "@/db/schema"

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
  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ))
  return row?.count ?? 0
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

/**
 * Delete read notifications older than `days` (default 90).
 * Call periodically from a cron job or admin action.
 */
export async function cleanupOldNotifications(days = 90): Promise<void> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  await db
    .delete(notifications)
    .where(and(eq(notifications.isRead, true), sql`${notifications.createdAt} < ${cutoff.toISOString()}`))
}

export interface AdminNotificationRow extends NotificationRow {
  userEmail: string | null
  userName: string | null
}

/** Admin: list latest notifications with user relation for diagnostic purposes. */
export async function listNotificationsForAdmin(
  filters: { userId?: string; isRead?: boolean; limit?: number } = {},
): Promise<AdminNotificationRow[]> {
  const limit = filters.limit ?? 500
  const conditions = []
  if (filters.userId) conditions.push(eq(notifications.userId, filters.userId))
  if (filters.isRead !== undefined) conditions.push(eq(notifications.isRead, filters.isRead))

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      entityHref: notifications.entityHref,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    entityHref: r.entityHref,
    isRead: r.isRead,
    createdAt: r.createdAt,
    userEmail: r.userEmail,
    userName: r.userName,
  }))
}

export interface NotificationStats {
  unreadCount: number
  totalRecent: number
  oldestReadDate: string | null
}

/** Admin: notification counters for the maintenance page. */
export async function getNotificationMaintenanceStats(): Promise<NotificationStats> {
  const [unreadRow] = await db
    .select({ count: count() })
    .from(notifications)
    .where(eq(notifications.isRead, false))

  const [totalRow] = await db
    .select({ count: count() })
    .from(notifications)

  const [oldestReadRow] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.isRead, true))
    .orderBy(notifications.createdAt)
    .limit(1)

  return {
    unreadCount: unreadRow?.count ?? 0,
    totalRecent: totalRow?.count ?? 0,
    oldestReadDate: oldestReadRow?.createdAt ?? null,
  }
}
