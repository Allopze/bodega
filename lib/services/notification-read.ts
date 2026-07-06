/**
 * Notification read and mark-as-read operations.
 */

import { eq, and, desc, sql } from "drizzle-orm"
import { db } from "@/db"
import { notifications } from "@/db/schema"

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
