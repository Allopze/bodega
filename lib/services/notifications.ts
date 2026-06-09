/**
 * In-app notification service.
 *
 * Notifications are created by server actions and services at key lifecycle points.
 * They are consumed by the NotificationBell component via /api/notifications.
 *
 * Design: fire-and-forget — notification creation never blocks the main action.
 * Callers wrap in try/catch or use the safe `notifySafe()` helper.
 */

import { eq, and, desc, inArray } from "drizzle-orm"
import { db } from "@/db"
import { notifications, rolePermissions, permissions, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { NotificationType } from "@/db/schema/audit"
import { sendEmail, getAppBaseUrl } from "@/lib/email/smtp"
import { logger } from "@/lib/logger"

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

  // Send email asynchronously
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { email: true, name: true },
  })
  if (user?.email) {
    const appUrl = getAppBaseUrl()
    const text = `${input.title}\n\n${input.body ?? ""}`
    const html = `
      <p>Hola ${user.name ?? "Usuario"},</p>
      <h3>${input.title}</h3>
      ${input.body ? `<p>${input.body}</p>` : ""}
      ${input.entityHref ? `<p><a href="${appUrl}${input.entityHref}">Ver detalle en Chome</a></p>` : ""}
    `
    sendEmail({
      to:      user.email,
      subject: input.title,
      text,
      html,
    }).catch((err) => {
      logger.error(`[notifications] failed to send email to ${user.email}`, err)
    })
  }
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

  // Send emails asynchronously to all users
  const targetUsers = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds))

  const appUrl = getAppBaseUrl()
  for (const u of targetUsers) {
    if (u.email) {
      const text = `${input.title}\n\n${input.body ?? ""}`
      const html = `
        <p>Hola ${u.name ?? "Usuario"},</p>
        <h3>${input.title}</h3>
        ${input.body ? `<p>${input.body}</p>` : ""}
        ${input.entityHref ? `<p><a href="${appUrl}${input.entityHref}">Ver detalle en Chome</a></p>` : ""}
      `
      sendEmail({
        to:      u.email,
        subject: input.title,
        text,
        html,
      }).catch((err) => {
        logger.error(`[notifications] failed to send email to ${u.email}`, err)
      })
    }
  }
}

/**
 * Fire-and-forget wrapper — logs errors but does NOT throw.
 * Use in server actions so notification failures never break the main flow.
 */
export async function notifySafe(input: CreateNotificationInput): Promise<void> {
  try { await createNotification(input) }
  catch (err) { logger.error("[notifications] failed to create notification", err) }
}

export async function notifyManyUser(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  try { await createNotifications(userIds, input) }
  catch (err) { logger.error("[notifications] failed to create notifications", err) }
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
