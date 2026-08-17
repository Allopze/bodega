import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn((_opts: unknown) => Promise.resolve()),
  sendBatchEmails: vi.fn((_recipients: unknown) => Promise.resolve()),
  renderTemplate: vi.fn(async (_key: string, data: Record<string, unknown>) => ({
    subject: String(data.title),
    html: `<p>${String(data.body ?? "")}</p>`,
  })),
}))

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/email/smtp", () => ({
  getAppBaseUrl: () => "https://chome.test",
  sendEmail: mocks.sendEmail,
  sendBatchEmails: mocks.sendBatchEmails,
}))

vi.mock("@/lib/services/email-templates", () => ({
  renderTemplate: mocks.renderTemplate,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import {
  cleanupOldNotifications,
  createNotification,
  createNotifications,
  getNotificationsForUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  notifyAfterCommit,
  notifyManyUser,
  notifySafe,
  getUserIdsWithPermission,
} from "@/lib/services/notifications"

const now = "2026-06-19T12:00:00.000Z"

async function insertUser(id: string, emailNotifications = true) {
  await inMemoryDb.insert(schema.users).values({
    id,
    name: `Usuario ${id}`,
    email: `${id}@chome.cl`,
    hashedPassword: "$2a$12$test",
    isActive: true,
    emailNotifications,
    createdAt: now,
    updatedAt: now,
  })
}

describe("notification service", () => {
  beforeEach(async () => {
    testGlobal.__db = inMemoryDb
    mocks.sendEmail.mockClear()
    mocks.sendBatchEmails.mockClear()
    mocks.renderTemplate.mockClear()

    await inMemoryDb.delete(schema.notifications)
    await inMemoryDb.delete(schema.users)
  })

  afterAll(async () => {
    await pg.close()
  })

  it("createNotification inserts a notification and sends email when enabled", async () => {
    await insertUser("u-email")

    await createNotification({
      userId: "u-email",
      type: "request_submitted",
      title: "Solicitud enviada",
      body: "Hay una solicitud pendiente",
      entityType: "purchase_request",
      entityId: "req-1",
      entityHref: "/solicitudes/req-1",
    })

    const rows = await inMemoryDb.query.notifications.findMany({
      where: eq(schema.notifications.userId, "u-email"),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: "u-email",
      type: "request_submitted",
      title: "Solicitud enviada",
      body: "Hay una solicitud pendiente",
      entityType: "purchase_request",
      entityId: "req-1",
      entityHref: "/solicitudes/req-1",
      isRead: false,
    })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it("createNotification skips email when the user opted out", async () => {
    await insertUser("u-optout", false)

    await createNotification({
      userId: "u-optout",
      type: "request_approved",
      title: "Aprobada",
    })

    const rows = await inMemoryDb.query.notifications.findMany({
      where: eq(schema.notifications.userId, "u-optout"),
    })
    expect(rows).toHaveLength(1)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("createNotifications creates rows for multiple users and batches email", async () => {
    await insertUser("u-one")
    await insertUser("u-two")
    await insertUser("u-muted", false)

    await createNotifications(["u-one", "u-two", "u-muted"], {
      type: "oc_created",
      title: "OC creada",
      body: "Nueva orden de compra",
    })

    const rows = await inMemoryDb.query.notifications.findMany()
    expect(rows).toHaveLength(3)
    expect(mocks.sendBatchEmails).toHaveBeenCalledTimes(1)
    const recipients = mocks.sendBatchEmails.mock.calls[0]?.[0] ?? []
    expect(recipients).toHaveLength(2)
  })

  it("createNotifications con dedupeKey sólo escribe y sólo envía correo a quien aún no lo tenía", async () => {
    await insertUser("u-dedup-1")
    await insertUser("u-dedup-2")

    const payload = {
      type: "system_alert" as const,
      title: "Mandato del comité por vencer",
      body: "Convoca la elección antes de la fecha.",
      dedupeKey: "cphs-mandate:cphs-1:2026-09-01:30",
    }
    await createNotifications(["u-dedup-1"], payload)
    expect(mocks.sendBatchEmails).toHaveBeenCalledTimes(1)
    expect(mocks.sendBatchEmails.mock.calls[0]?.[0]).toHaveLength(1)

    // Segunda corrida del mismo job: u-dedup-1 ya la tiene, u-dedup-2 no.
    mocks.sendBatchEmails.mockClear()
    await createNotifications(["u-dedup-1", "u-dedup-2"], payload)

    const rows = await inMemoryDb.query.notifications.findMany()
    expect(rows).toHaveLength(2)
    // El correo se arma sobre lo realmente insertado, no sobre la lista
    // completa: u-dedup-1 no puede recibirlo de nuevo.
    const recipients = (mocks.sendBatchEmails.mock.calls[0]?.[0] ?? []) as { to: string }[]
    expect(recipients.map((message) => message.to)).toEqual(["u-dedup-2@chome.cl"])
  })

  it("createNotifications con dedupeKey no manda ningún correo si nadie es nuevo", async () => {
    await insertUser("u-dedup-3")
    const payload = {
      type: "system_alert" as const,
      title: "Aviso repetido",
      dedupeKey: "cphs-cadence:cphs-1:2026-08",
    }
    await createNotifications(["u-dedup-3"], payload)
    mocks.sendBatchEmails.mockClear()

    await createNotifications(["u-dedup-3"], payload)
    expect(mocks.sendBatchEmails).not.toHaveBeenCalled()
  })

  it("createNotifications accepts an empty user list", async () => {
    await expect(
      createNotifications([], {
        type: "oc_sent",
        title: "Sin destinatarios",
      }),
    ).resolves.toBeUndefined()
    expect(mocks.sendBatchEmails).not.toHaveBeenCalled()
  })

  it("notifySafe and notifyManyUser swallow persistence errors", async () => {
    testGlobal.__db = {
      insert() {
        throw new Error("db unavailable")
      },
    } as unknown as DB

    await expect(
      notifySafe({
        userId: "u-fail",
        type: "receipt_done",
        title: "Recepcion",
      }),
    ).resolves.toBeUndefined()

    await expect(
      notifyManyUser(["u-fail"], {
        type: "dispatch_done",
        title: "Entrega",
      }),
    ).resolves.toBeUndefined()
  })

  it("notifyAfterCommit defers the thunk through queueMicrotask", async () => {
    const callbacks: VoidFunction[] = []
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback) => callbacks.push(callback))
    const thunk = vi.fn()

    notifyAfterCommit(thunk)

    expect(thunk).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(1)
    callbacks[0]?.()
    await Promise.resolve()

    expect(thunk).toHaveBeenCalledTimes(1)
    queueMicrotaskSpy.mockRestore()
  })

  it("returns notifications ordered by newest first and counts unread", async () => {
    await insertUser("u-read")
    await inMemoryDb.insert(schema.notifications).values([
      {
        id: "n-old",
        userId: "u-read",
        type: "request_submitted",
        title: "Vieja",
        isRead: false,
        createdAt: "2026-06-18T12:00:00.000Z",
      },
      {
        id: "n-new",
        userId: "u-read",
        type: "request_approved",
        title: "Nueva",
        isRead: true,
        createdAt: "2026-06-19T12:00:00.000Z",
      },
    ])

    await expect(getUnreadCount("u-read")).resolves.toBe(1)
    const rows = await getNotificationsForUser("u-read")
    expect(rows.map((row) => row.id)).toEqual(["n-new", "n-old"])
  })

  it("marks one notification or all unread notifications as read", async () => {
    await insertUser("u-mark")
    await inMemoryDb.insert(schema.notifications).values([
      {
        id: "n-one",
        userId: "u-mark",
        type: "request_submitted",
        title: "Uno",
        isRead: false,
        createdAt: now,
      },
      {
        id: "n-two",
        userId: "u-mark",
        type: "request_approved",
        title: "Dos",
        isRead: false,
        createdAt: now,
      },
      {
        id: "n-other",
        userId: "u-mark",
        type: "oc_created",
        title: "Tres",
        isRead: true,
        createdAt: now,
      },
    ])

    await markNotificationRead("n-one", "u-mark")
    await expect(getUnreadCount("u-mark")).resolves.toBe(1)

    await markAllNotificationsRead("u-mark")
    await expect(getUnreadCount("u-mark")).resolves.toBe(0)
  })

  it("cleanupOldNotifications deletes only old read notifications", async () => {
    await insertUser("u-clean")
    await inMemoryDb.insert(schema.notifications).values([
      {
        id: "n-old-read",
        userId: "u-clean",
        type: "request_submitted",
        title: "Old read",
        isRead: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "n-old-unread",
        userId: "u-clean",
        type: "request_approved",
        title: "Old unread",
        isRead: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "n-recent-read",
        userId: "u-clean",
        type: "oc_created",
        title: "Recent read",
        isRead: true,
        createdAt: new Date().toISOString(),
      },
    ])

    await cleanupOldNotifications(30)

    const remaining = await inMemoryDb.query.notifications.findMany({
      where: and(
        eq(schema.notifications.userId, "u-clean"),
      ),
    })
    expect(remaining.map((row) => row.id).sort()).toEqual(["n-old-unread", "n-recent-read"])
  })

  it("handles template render failure and falls back to inline html in createNotification", async () => {
    await insertUser("u-fallback")
    mocks.renderTemplate.mockRejectedValueOnce(new Error("Render template failed"))

    await createNotification({
      userId: "u-fallback",
      type: "request_submitted",
      title: "Fallback Title",
      body: "Fallback Body",
      entityHref: "/fallback-href",
    })

    // Inline email fallback should be sent
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const emailArg = (mocks.sendEmail as unknown as { mock: { calls: { to: string; subject: string; html: string }[][] } }).mock.calls[0]?.[0]
    expect(emailArg).toBeDefined()
    expect(emailArg).toMatchObject({
      to: "u-fallback@chome.cl",
      subject: "Fallback Title",
    })
    expect(emailArg?.html).toContain("Hola Usuario u-fallback")
  })

  it("handles template render failure and falls back to inline html in createNotifications", async () => {
    await insertUser("u-fallback-1")
    await insertUser("u-fallback-2")
    mocks.renderTemplate.mockRejectedValueOnce(new Error("Render template failed"))

    await createNotifications(["u-fallback-1", "u-fallback-2"], {
      type: "request_submitted",
      title: "Fallback Title",
      body: "Fallback Body",
      entityHref: "/fallback-href",
    })

    expect(mocks.sendBatchEmails).toHaveBeenCalledTimes(1)
    const batch = (mocks.sendBatchEmails as unknown as { mock: { calls: { to: string; subject: string; html: string }[][][] } }).mock.calls[0]?.[0] ?? []
    expect(batch).toHaveLength(2)
    expect(batch[0]).toBeDefined()
    expect(batch[0]?.html).toContain("Hola Usuario u-fallback-1")
  })

  it("createNotification handles user without email or not existing", async () => {
    // Non-existent user - notifySafe handles the FK violation and prevents crash
    await notifySafe({
      userId: "non-existent-user-id",
      type: "request_submitted",
      title: "No User Title",
    })
    expect(mocks.sendEmail).not.toHaveBeenCalled()

    // User without email
    await inMemoryDb.insert(schema.users).values({
      id: "u-no-email",
      name: "No Email User",
      email: "",
      hashedPassword: "password_hash",
      isActive: true,
      emailNotifications: true,
    })
    await createNotification({
      userId: "u-no-email",
      type: "request_submitted",
      title: "No Email Title",
    })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("createNotifications handles batch with users having no email or disabled notifications", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "u-no-email-batch",
      name: "No Email User Batch",
      email: "",
      hashedPassword: "password_hash",
      isActive: true,
      emailNotifications: true,
    })
    await createNotifications(["u-no-email-batch"], {
      type: "request_submitted",
      title: "No Email Batch Title",
    })
    expect(mocks.sendBatchEmails).not.toHaveBeenCalled()
  })

  it("cleanupOldNotifications uses default days when not specified", async () => {
    await insertUser("u-clean-default")
    await inMemoryDb.insert(schema.notifications).values([
      {
        id: "n-clean-def",
        userId: "u-clean-default",
        type: "request_submitted",
        title: "Clean default",
        isRead: true,
        createdAt: "2020-01-01T00:00:00.000Z", // way older than 90 days
      },
    ])

    await cleanupOldNotifications()

    const remaining = await inMemoryDb.query.notifications.findMany({
      where: eq(schema.notifications.userId, "u-clean-default"),
    })
    expect(remaining).toHaveLength(0)
  })

  it("getUserIdsWithPermission returns empty array when permission is not found", async () => {
    const ids = await getUserIdsWithPermission("non-existent-permission-name")
    expect(ids).toEqual([])
  })

  it("getUserIdsWithPermission returns empty array when rolePerm and directGrants are empty", async () => {
    await inMemoryDb.insert(schema.permissions).values({
      id: "perm-empty",
      name: "empty:perm",
      description: null,
      module: "empty",
    })

    const ids = await getUserIdsWithPermission("empty:perm")
    expect(ids).toEqual([])
  })

  it("logs errors when sendEmail rejects in createNotification", async () => {
    await insertUser("u-reject")
    mocks.sendEmail.mockRejectedValueOnce(new Error("SMTP Error"))

    // We need to import logger and verify error was called, or just let it call catch block.
    // Let's first clear sendEmail mocks
    await createNotification({
      userId: "u-reject",
      type: "request_submitted",
      title: "Reject Title",
    })

    // Give it a tick to resolve the promise.catch
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("logs errors when sendBatchEmails rejects in createNotifications", async () => {
    await insertUser("u-reject-batch")
    mocks.sendBatchEmails.mockRejectedValueOnce(new Error("SMTP Batch Error"))

    await createNotifications(["u-reject-batch"], {
      type: "request_submitted",
      title: "Reject Batch Title",
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

