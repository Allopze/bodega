/**
 * lib/services/prevention-documents/expiry.ts
 * Cron service: vence documentos SST cuya `expiresAt` ya pasó (el status
 * persistido nunca transicionaba solo — sólo se computaba al leer via
 * `effectiveStatus()`, lo que dejaba `WHERE status = 'vencido'` sin
 * resultados y cualquier filtro directo por `status` desincronizado del
 * badge que ve el usuario) y notifica vencimientos próximos usando los
 * umbrales ya definidos en `EXPIRY_ALERT_THRESHOLDS` (30/15/7 días).
 *
 * Invocar desde: GET /api/cron/sst-document-expiry
 */
import { and, eq, isNotNull, lt } from "drizzle-orm"
import { db } from "@/db"
import { sstDocuments } from "@/db/schema"
import { recordStatusChange } from "@/lib/audit"
import { notifyManyUser, getUserIdsWithPermissionForWorksite, getUserIdsWithPermission } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import { EXPIRY_ALERT_THRESHOLDS, daysUntil, recordAuditEntry, todayIso } from "./utils"

/** Transiciona a `vencido` los documentos vigentes cuya expiresAt ya pasó. */
export async function expireOverdueDocuments(): Promise<{ expired: number }> {
  const today = todayIso()
  const overdue = await db
    .select({ id: sstDocuments.id, expiresAt: sstDocuments.expiresAt })
    .from(sstDocuments)
    .where(and(eq(sstDocuments.status, "vigente"), isNotNull(sstDocuments.expiresAt), lt(sstDocuments.expiresAt, today)))

  const now = new Date().toISOString()
  for (const doc of overdue) {
    await db.update(sstDocuments).set({ status: "vencido", updatedAt: now }).where(eq(sstDocuments.id, doc.id))
    await recordStatusChange({ entityType: "sst_document", entityId: doc.id, fromStatus: "vigente", toStatus: "vencido", changedBy: null, reason: "Vencimiento automático" })
    await recordAuditEntry({ documentId: doc.id, action: "status_change", fromStatus: "vigente", toStatus: "vencido", comment: "Vencimiento automático" })
  }
  return { expired: overdue.length }
}

/** Notifica documentos vigentes que cruzan un umbral de vencimiento (30/15/7 días). */
export async function notifyExpiringDocuments(): Promise<{ notified: number }> {
  const vigentes = await db
    .select({ id: sstDocuments.id, title: sstDocuments.title, expiresAt: sstDocuments.expiresAt, worksiteId: sstDocuments.worksiteId, responsibleUserId: sstDocuments.responsibleUserId })
    .from(sstDocuments)
    .where(and(eq(sstDocuments.status, "vigente"), isNotNull(sstDocuments.expiresAt)))

  const globalApprovers = await getUserIdsWithPermission("prevention:docs:approve")
  let notified = 0

  for (const doc of vigentes) {
    const days = daysUntil(doc.expiresAt)
    if (days === null || !(EXPIRY_ALERT_THRESHOLDS as readonly number[]).includes(days)) continue

    const recipients = new Set<string>(doc.worksiteId ? await getUserIdsWithPermissionForWorksite("prevention:docs:approve", doc.worksiteId) : globalApprovers)
    if (doc.responsibleUserId) recipients.add(doc.responsibleUserId)
    if (recipients.size === 0) continue

    try {
      await notifyManyUser([...recipients], {
        type: "sst_document_expiring",
        title: `"${doc.title}" vence en ${days} día${days === 1 ? "" : "s"}`,
        body: `Vence el ${doc.expiresAt}.`,
        entityType: "sst_document",
        entityId: doc.id,
        entityHref: `/prevencion/documentacion/${doc.id}`,
      })
      notified += 1
    } catch (err) {
      logger.error("[prevention-documents/expiry] fallo al notificar vencimiento", err)
    }
  }
  return { notified }
}
