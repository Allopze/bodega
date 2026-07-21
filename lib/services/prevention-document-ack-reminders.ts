import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocumentDistributionTargets,
  sstDocuments,
  sstDocumentVersions,
  users,
} from "@/db/schema"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"

export interface DocumentAckReminderResult {
  pendingTargets: number
  remindersSent: number
  overdueTargets: number
  escalatedTargets: number
  notifiedUsers: number
}

export function shouldSendDocumentAckReminder(args: {
  now: Date
  lastReminderAt: string | null
  dueAt: string | null
}) {
  if (!args.lastReminderAt) return true
  const elapsedDays = Math.floor((args.now.getTime() - Date.parse(args.lastReminderAt)) / 86_400_000)
  const overdue = Boolean(args.dueAt && Date.parse(args.dueAt) < args.now.getTime())
  return elapsedDays >= (overdue ? 1 : args.dueAt ? 3 : 7)
}

export async function runPreventionDocumentAckReminders(now = new Date()): Promise<DocumentAckReminderResult> {
  const rows = await db.select({
    target: sstDocumentDistributionTargets,
    documentId: sstDocuments.id,
    documentTitle: sstDocuments.title,
    documentWorksiteId: sstDocuments.worksiteId,
    checksum: sstDocumentVersions.checksum,
  }).from(sstDocumentDistributionTargets)
    .innerJoin(sstDocumentVersions, eq(sstDocumentDistributionTargets.versionId, sstDocumentVersions.id))
    .innerJoin(sstDocuments, eq(sstDocumentVersions.documentId, sstDocuments.id))
    .where(and(
      eq(sstDocumentDistributionTargets.status, "pendiente"),
      eq(sstDocumentVersions.status, "vigente"),
      eq(sstDocuments.status, "vigente"),
      eq(sstDocuments.currentVersionId, sstDocumentDistributionTargets.versionId),
    ))

  const notified = new Set<string>()
  let remindersSent = 0
  let overdueTargets = 0
  let escalatedTargets = 0
  const today = now.toISOString().slice(0, 10)

  // Pre-resolver managers de distribución por faena
  const worksiteIds = [...new Set(rows.map((r) => r.target.worksiteId ?? r.documentWorksiteId).filter((id): id is string => id !== null && id !== undefined))]
  const managersByWs = new Map<string, string[]>()
  await Promise.all(worksiteIds.map(async (wsId) => {
    managersByWs.set(wsId, await getUserIdsWithPermissionForWorksite("prevention:docs:distribute", wsId))
  }))

  for (const row of rows) {
    const target = row.target
    const overdue = Boolean(target.dueAt && Date.parse(target.dueAt) < now.getTime())
    if (overdue) overdueTargets++
    if (!shouldSendDocumentAckReminder({ now, lastReminderAt: target.lastReminderAt, dueAt: target.dueAt })) continue

    let recipientIds = target.userId ? [target.userId] : []
    if (recipientIds.length === 0 && target.workerId) {
      const linkedUsers = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.workerId, target.workerId), eq(users.isActive, true)))
      recipientIds = linkedUsers.map((user) => user.id)
    }
    const worksiteId = target.worksiteId ?? row.documentWorksiteId
    const managers = worksiteId
      ? (managersByWs.get(worksiteId) ?? [])
      : []
    if (recipientIds.length === 0) recipientIds = managers
    const href = `/prevencion/documentacion/${row.documentId}`
    const recipients = Array.from(new Set(recipientIds))
    recipients.forEach((id) => notified.add(id))
    await createNotifications(recipients, {
      type: "system_alert",
      title: `${overdue ? "Acuse vencido" : "Acuse pendiente"}: ${row.documentTitle}`,
      body: `Debes revisar y acusar la versión asignada. El acuse quedará firmado contra el checksum ${row.checksum.slice(0, 12)}…${target.dueAt ? ` Plazo: ${target.dueAt.slice(0, 10)}.` : ""}`,
      entityType: "sst_document_distribution",
      entityId: target.id,
      entityHref: href,
      dedupeKey: `document-ack-reminder:${target.id}:${today}`,
    })
    remindersSent++

    if (overdue && managers.length > 0) {
      managers.forEach((id) => notified.add(id))
      await createNotifications(managers, {
        type: "system_alert",
        title: `Escalamiento de acuse: ${row.documentTitle}`,
        body: `La asignación ${target.id} sigue pendiente después del plazo. Revisa vigencia del destinatario, exención o redistribución.`,
        entityType: "sst_document_distribution",
        entityId: target.id,
        entityHref: href,
        dedupeKey: `document-ack-overdue:${target.id}:${today}`,
      })
      escalatedTargets++
    }

    await db.update(sstDocumentDistributionTargets).set({
      lastReminderAt: now.toISOString(),
      reminderCount: sql`${sstDocumentDistributionTargets.reminderCount} + 1`,
      updatedAt: now.toISOString(),
    }).where(and(
      eq(sstDocumentDistributionTargets.id, target.id),
      eq(sstDocumentDistributionTargets.status, "pendiente"),
    ))
  }

  return {
    pendingTargets: rows.length,
    remindersSent,
    overdueTargets,
    escalatedTargets,
    notifiedUsers: notified.size,
  }
}
