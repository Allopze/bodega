/**
 * Notification creation service.
 * Fire-and-forget design — notification creation never blocks the main action.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { notifications, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { NotificationType } from "@/db/schema/audit"
import { sendEmail, sendBatchEmails, getAppBaseUrl } from "@/lib/email/smtp"
import { renderTemplate } from "@/lib/services/email-templates"
import { escapeHtml } from "@/lib/utils"
import { logger } from "@/lib/logger"

export interface CreateNotificationInput {
  userId:     string
  type:       NotificationType
  title:      string
  body?:      string
  entityType?: string
  entityId?:  string
  entityHref?: string
  /**
   * Deduplication key. If set, no second notification with the same
   * `(userId, dedupeKey)` will be created (partial unique index in DB).
   * Useful for recurring reminders.
   */
  dedupeKey?: string
}

/**
 * Creates a single notification for a user. Throws on DB error.
 * Prefer `notifySafe()` in server actions to avoid blocking on errors.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  if (input.dedupeKey) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.userId, input.userId),
        eq(notifications.dedupeKey, input.dedupeKey),
      ))
      .limit(1)
    if (existing.length > 0) return
  }

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
    dedupeKey:  input.dedupeKey ?? null,
  })

  // S-15: Send email only if the user has email_notifications enabled (default true).
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { email: true, name: true, emailNotifications: true },
  })
  if (user?.email && user.emailNotifications !== false) {
    try {
      const rendered = await renderTemplate("notification", {
        user_name: user.name ?? "Usuario",
        title:     input.title,
        body:      input.body ?? "",
        href:      input.entityHref ? `${getAppBaseUrl()}${input.entityHref}` : "",
        app_name:  "Plataforma Chome",
      })
      const text = `${input.title}\n\n${input.body ?? ""}`
      sendEmail({
        to:      user.email,
        subject: rendered.subject,
        text,
        html:    rendered.html,
      }).catch((err) => {
        logger.error(`[notifications] failed to send email to ${user.email}`, err)
      })
    } catch {
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
}

/**
 * Creates notifications for multiple users. Throws on DB error.
 */
export async function createNotifications(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  if (userIds.length === 0) return

  const values = userIds.map((userId) => ({
    id:         nanoid(),
    userId,
    type:       input.type,
    title:      input.title,
    body:       input.body ?? null,
    entityType: input.entityType ?? null,
    entityId:   input.entityId ?? null,
    entityHref: input.entityHref ?? null,
    isRead:     false,
    dedupeKey:  input.dedupeKey ?? null,
  }))

  // Destinatarios del correo = a quienes REALMENTE se les insertó la
  // notificación. Con `dedupeKey`, el INSERT ya deduplicaba pero el correo se
  // armaba sobre la lista completa: correr dos veces un job diario mandaba el
  // correo dos veces aunque no naciera ninguna notificación nueva.
  let recipientIds = userIds
  if (input.dedupeKey) {
    const existing = await db
      .selectDistinct({ userId: notifications.userId })
      .from(notifications)
      .where(and(
        eq(notifications.dedupeKey, input.dedupeKey),
        inArray(notifications.userId, userIds),
      ))
    const skipUserIds = new Set(existing.map((r) => r.userId))
    const toInsert = values.filter((v) => !skipUserIds.has(v.userId))
    if (toInsert.length === 0) return
    await db.insert(notifications).values(toInsert)
    recipientIds = toInsert.map((v) => v.userId)
  } else {
    await db.insert(notifications).values(values)
  }

  // Send emails asynchronously — batch into a single SMTP connection
  const targetUsers = await db
    .select({ id: users.id, email: users.email, name: users.name, emailNotifications: users.emailNotifications })
    .from(users)
    .where(inArray(users.id, recipientIds))

  const appUrl = getAppBaseUrl()
  const emailMessages: Array<{ to: string; subject: string; text: string; html: string }> = []

  for (const u of targetUsers) {
    if (u.email && u.emailNotifications !== false) {
      try {
        const rendered = await renderTemplate("notification", {
          user_name: u.name ?? "Usuario",
          title:     input.title,
          body:      input.body ?? "",
          href:      input.entityHref ? `${appUrl}${input.entityHref}` : "",
          app_name:  "Plataforma Chome",
        })
        const text = `${input.title}\n\n${input.body ?? ""}`
        emailMessages.push({ to: u.email, subject: rendered.subject, text, html: rendered.html })
      } catch {
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

/**
 * Fire-and-forget with retry — for critical notifications (approval, rejection, return).
 * Retries up to 2 times with exponential backoff (300ms, 900ms) on DB errors.
 */
export async function notifySafeWithRetry(input: CreateNotificationInput): Promise<void> {
  const BACKOFF_MS = [300, 900]
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      await createNotification(input)
      return
    } catch (err) {
      if (attempt < BACKOFF_MS.length) {
        logger.warn(
          `[notifications] retry ${attempt + 1}/${BACKOFF_MS.length} for userId=${input.userId} type=${input.type}`,
          err,
        )
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]))
      } else {
        logger.error(
          `[notifications] all retries exhausted for userId=${input.userId} type=${input.type}`,
          err,
        )
      }
    }
  }
}

export async function notifyManyUser(
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  try { await createNotifications(userIds, input) }
  catch (err) { logger.error("[notifications] failed to create notifications", err) }
}

/**
 * S-05: difiere el envío al siguiente microtask, no al COMMIT.
 *
 * Sólo sirve DESPUÉS de que `await db.transaction(...)` haya resuelto. Llamarlo
 * DENTRO del callback de una transacción notifica antes de tiempo: el microtask
 * se drena en el primer `await` siguiente y `createNotification*` escribe con el
 * `db` global (otra conexión del pool), así que un ROLLBACK posterior no deshace
 * ni la notificación ni el correo.
 */
export function notifyAfterCommit(thunk: () => unknown | Promise<unknown>): void {
  queueMicrotask(() => {
    Promise.resolve()
      .then(() => thunk())
      .catch((err) => logger.error("[notifications] post-commit notify failed", err))
  })
}
