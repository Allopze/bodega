/**
 * In-app notification service.
 *
 * Notifications are created by server actions and services at key lifecycle points.
 * They are consumed by the NotificationBell component via /api/notifications.
 *
 * Design: fire-and-forget — notification creation never blocks the main action.
 * Callers wrap in try/catch or use the safe `notifySafe()` helper.
 */

import { eq, and, desc, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { notifications, rolePermissions, userPermissions, permissions, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { NotificationType } from "@/db/schema/audit"
import { sendEmail, sendBatchEmails, getAppBaseUrl } from "@/lib/email/smtp"
import { escapeHtml } from "@/lib/utils"
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
    const safeName = escapeHtml(user.name ?? "Usuario")
    const safeTitle = escapeHtml(input.title)
    const safeBody = input.body ? escapeHtml(input.body) : ""
    const safeHref = input.entityHref ? escapeHtml(`${appUrl}${input.entityHref}`) : ""
    const text = `${input.title}\n\n${input.body ?? ""}`
    const html = `
      <p>Hola ${safeName},</p>
      <h3>${safeTitle}</h3>
      ${safeBody ? `<p>${safeBody}</p>` : ""}
      ${safeHref ? `<p><a href="${safeHref}">Ver detalle en Chome</a></p>` : ""}
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

  // Send emails asynchronously — batch into a single SMTP connection
  const targetUsers = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds))

  const appUrl = getAppBaseUrl()
  const emailMessages: Array<{ to: string; subject: string; text: string; html: string }> = []

  for (const u of targetUsers) {
    if (u.email) {
      const safeName = escapeHtml(u.name ?? "Usuario")
      const safeTitle = escapeHtml(input.title)
      const safeBody = input.body ? escapeHtml(input.body) : ""
      const safeHref = input.entityHref ? escapeHtml(`${appUrl}${input.entityHref}`) : ""
      const text = `${input.title}\n\n${input.body ?? ""}`
      const html = `
        <p>Hola ${safeName},</p>
        <h3>${safeTitle}</h3>
        ${safeBody ? `<p>${safeBody}</p>` : ""}
        ${safeHref ? `<p><a href="${safeHref}">Ver detalle en Chome</a></p>` : ""}
      `
      emailMessages.push({ to: u.email, subject: input.title, text, html })
    }
  }

  if (emailMessages.length > 0) {
    sendBatchEmails(emailMessages).catch((err) => {
      logger.error("[notifications] failed to send batch emails", err)
    })
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

/**
 * S-05: schedule a notification to run only after the current Server
 * Action returns to the runtime (i.e. after the surrounding DB
 * transaction has committed). Until now the code fired notifications
 * with `void …` *before* the transaction could fail, leaking emails for
 * requests/orders that never made it to the DB.
 *
 * We piggyback on Node's microtask queue: by the time the runtime
 * drains the microtask, the Server Action's `await db.transaction(...)`
 * has resolved and the commit is durable. For deeper safety, the
 * notification functions are still wrapped in their own try/catch
 * (notifyManyUser / notifySafe) so a notification failure never
 * propagates back.
 */
export function notifyAfterCommit(thunk: () => unknown | Promise<unknown>): void {
  // Use queueMicrotask so the call is deferred until the current
  // synchronous tail of the action finishes. For await calls inside the
  // thunk, the action's own `await` will have already returned by the
  // time the microtask runs.
  queueMicrotask(() => {
    Promise.resolve()
      .then(() => thunk())
      .catch((err) => logger.error("[notifications] post-commit notify failed", err))
  })
}

/* ── Permission-based targeting ──────────────────────────────────────────────── */

/**
 * Returns user IDs who have at least one of the given permissions.
 * Considers both role-based grants and direct user-permission grants.
 * Used to notify approvers, warehouse staff, etc.
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
    for (const ur of userRole) userIds.add(ur.userId)
  }

  // Users with direct permission grants (userPermissions table)
  const directGrants = await db.query.userPermissions.findMany({
    where: eq(userPermissions.permissionId, perm.id),
  })
  if (directGrants.length > 0) {
    // Only include active users with direct grants
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
