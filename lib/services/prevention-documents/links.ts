import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentLinks, sstDocuments } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { WorksiteScope } from "@/lib/auth/scope"
import { assertScopeAccess, recordAuditEntry } from "./utils"

export type DocumentLinkEntityType = "pdtp_activity" | "pdtp_execution" | "pdtp_checklist" | "sst_evaluation" | "corrective_action" | "ppa"

export async function createDocumentLink(args: {
  documentId: string; entityType: DocumentLinkEntityType; entityId: string; notes?: string; userId: string; scope: WorksiteScope
}) {
  const [document] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, args.documentId)).limit(1)
  if (!document) throw new Error("Documento no encontrado.")
  assertScopeAccess(document.worksiteId, args.scope)
  const now = new Date().toISOString()
  await db.insert(sstDocumentLinks).values({
    id: `sdlink-${nanoid()}`, documentId: args.documentId, entityType: args.entityType, entityId: args.entityId,
    notes: args.notes?.trim() || null, createdByUserId: args.userId, createdAt: now,
  }).onConflictDoNothing()
  await recordAuditEntry({ documentId: args.documentId, userId: args.userId, action: "link", metadata: { entityType: args.entityType, entityId: args.entityId } })
}

export async function removeDocumentLink(args: { linkId: string; reason: string; userId: string; scope: WorksiteScope }) {
  if (args.reason.trim().length < 3) throw new Error("Indica el motivo del retiro del vínculo.")
  const [row] = await db.select({ link: sstDocumentLinks, document: sstDocuments }).from(sstDocumentLinks)
    .innerJoin(sstDocuments, eq(sstDocumentLinks.documentId, sstDocuments.id)).where(and(eq(sstDocumentLinks.id, args.linkId), isNull(sstDocumentLinks.removedAt))).limit(1)
  if (!row) throw new Error("Vínculo no encontrado o ya retirado.")
  assertScopeAccess(row.document.worksiteId, args.scope)
  const now = new Date().toISOString()
  await db.update(sstDocumentLinks).set({ removedByUserId: args.userId, removedAt: now, removalReason: args.reason.trim() }).where(eq(sstDocumentLinks.id, args.linkId))
  await recordAuditEntry({ documentId: row.document.id, userId: args.userId, action: "unlink", comment: args.reason.trim(), metadata: { linkId: args.linkId, entityType: row.link.entityType, entityId: row.link.entityId } })
}
