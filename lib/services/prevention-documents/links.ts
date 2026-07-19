import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpExecutionChecklists,
  pdtpExecutions,
  ppaSubmissions,
  preventionCapaActions,
  sstDocumentLinks,
  sstDocuments,
  sstEvaluations,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { WorksiteScope } from "@/lib/auth/scope"
import { assertScopeAccess, recordAuditEntry } from "./utils"

export const DOCUMENT_LINK_ENTITY_TYPES = [
  "worker",
  "worksite",
  "pdtp_activity",
  "pdtp_execution",
  "pdtp_checklist",
  "sst_evaluation",
  "corrective_action",
  "ppa",
] as const

export type DocumentLinkEntityType = typeof DOCUMENT_LINK_ENTITY_TYPES[number]

interface DocumentLinkTargetInspection {
  linkId: string
  supported: boolean
  exists: boolean
  worksiteId: string | null
}

export async function inspectDocumentLinkTargets(
  links: ReadonlyArray<{ id: string; entityType: string; entityId: string }>,
): Promise<DocumentLinkTargetInspection[]> {
  const idsFor = (type: DocumentLinkEntityType) => {
    const ids = new Set<string>()
    for (const link of links) {
      if (link.entityType === type) ids.add(link.entityId)
    }
    return Array.from(ids)
  }
  const workerIds = idsFor("worker")
  const worksiteIds = idsFor("worksite")
  const activityIds = idsFor("pdtp_activity")
  const executionIds = idsFor("pdtp_execution")
  const checklistIds = idsFor("pdtp_checklist")
  const evaluationIds = idsFor("sst_evaluation")
  const actionIds = idsFor("corrective_action")
  const ppaIds = idsFor("ppa")

  const [workerRows, worksiteRows, activityRows, executionRows, checklistRows, evaluationRows, actionRows, ppaRows] = await Promise.all([
    workerIds.length ? db.select({ id: workers.id, worksiteId: workers.worksiteId }).from(workers).where(inArray(workers.id, workerIds)) : [],
    worksiteIds.length ? db.select({ id: worksites.id, worksiteId: worksites.id }).from(worksites).where(inArray(worksites.id, worksiteIds)) : [],
    activityIds.length ? db.select({ id: pdtpActivities.id }).from(pdtpActivities).where(inArray(pdtpActivities.id, activityIds)) : [],
    executionIds.length ? db.select({ id: pdtpExecutions.id, worksiteId: pdtpExecutions.worksiteId }).from(pdtpExecutions).where(inArray(pdtpExecutions.id, executionIds)) : [],
    checklistIds.length ? db.select({ id: pdtpExecutionChecklists.id, worksiteId: pdtpExecutions.worksiteId })
      .from(pdtpExecutionChecklists).innerJoin(pdtpExecutions, eq(pdtpExecutionChecklists.executionId, pdtpExecutions.id))
      .where(inArray(pdtpExecutionChecklists.id, checklistIds)) : [],
    evaluationIds.length ? db.select({ id: sstEvaluations.id, worksiteId: sstEvaluations.worksiteId }).from(sstEvaluations).where(inArray(sstEvaluations.id, evaluationIds)) : [],
    actionIds.length ? db.select({ id: preventionCapaActions.id, worksiteId: preventionCapaActions.worksiteId }).from(preventionCapaActions).where(inArray(preventionCapaActions.id, actionIds)) : [],
    ppaIds.length ? db.select({ id: ppaSubmissions.id, worksiteId: ppaSubmissions.worksiteId }).from(ppaSubmissions).where(inArray(ppaSubmissions.id, ppaIds)) : [],
  ])

  const targets = new Map<string, string | null>()
  for (const row of workerRows) targets.set(`worker:${row.id}`, row.worksiteId)
  for (const row of worksiteRows) targets.set(`worksite:${row.id}`, row.worksiteId)
  for (const row of activityRows) targets.set(`pdtp_activity:${row.id}`, null)
  for (const row of executionRows) targets.set(`pdtp_execution:${row.id}`, row.worksiteId)
  for (const row of checklistRows) targets.set(`pdtp_checklist:${row.id}`, row.worksiteId)
  for (const row of evaluationRows) targets.set(`sst_evaluation:${row.id}`, row.worksiteId)
  for (const row of actionRows) targets.set(`corrective_action:${row.id}`, row.worksiteId)
  for (const row of ppaRows) targets.set(`ppa:${row.id}`, row.worksiteId)

  const supportedTypes = new Set<string>(DOCUMENT_LINK_ENTITY_TYPES)
  return links.map((link) => {
    const supported = supportedTypes.has(link.entityType)
    const key = `${link.entityType}:${link.entityId}`
    return {
      linkId: link.id,
      supported,
      exists: supported && targets.has(key),
      worksiteId: targets.get(key) ?? null,
    }
  })
}

export async function resolveDocumentLinkTarget(entityType: DocumentLinkEntityType, entityId: string) {
  switch (entityType) {
    case "worker": {
      const [row] = await db.select({ id: workers.id, worksiteId: workers.worksiteId })
        .from(workers).where(eq(workers.id, entityId)).limit(1)
      return row ?? null
    }
    case "worksite": {
      const [row] = await db.select({ id: worksites.id, worksiteId: worksites.id })
        .from(worksites).where(eq(worksites.id, entityId)).limit(1)
      return row ?? null
    }
    case "pdtp_activity": {
      const [row] = await db.select({ id: pdtpActivities.id }).from(pdtpActivities)
        .where(eq(pdtpActivities.id, entityId)).limit(1)
      return row ? { ...row, worksiteId: null } : null
    }
    case "pdtp_execution": {
      const [row] = await db.select({ id: pdtpExecutions.id, worksiteId: pdtpExecutions.worksiteId })
        .from(pdtpExecutions).where(eq(pdtpExecutions.id, entityId)).limit(1)
      return row ?? null
    }
    case "pdtp_checklist": {
      const [row] = await db.select({ id: pdtpExecutionChecklists.id, worksiteId: pdtpExecutions.worksiteId })
        .from(pdtpExecutionChecklists)
        .innerJoin(pdtpExecutions, eq(pdtpExecutionChecklists.executionId, pdtpExecutions.id))
        .where(eq(pdtpExecutionChecklists.id, entityId)).limit(1)
      return row ?? null
    }
    case "sst_evaluation": {
      const [row] = await db.select({ id: sstEvaluations.id, worksiteId: sstEvaluations.worksiteId })
        .from(sstEvaluations).where(eq(sstEvaluations.id, entityId)).limit(1)
      return row ?? null
    }
    case "corrective_action": {
      const [row] = await db.select({ id: preventionCapaActions.id, worksiteId: preventionCapaActions.worksiteId })
        .from(preventionCapaActions).where(eq(preventionCapaActions.id, entityId)).limit(1)
      return row ?? null
    }
    case "ppa": {
      const [row] = await db.select({ id: ppaSubmissions.id, worksiteId: ppaSubmissions.worksiteId })
        .from(ppaSubmissions).where(eq(ppaSubmissions.id, entityId)).limit(1)
      return row ?? null
    }
  }
}

export async function createDocumentLink(args: {
  documentId: string; entityType: DocumentLinkEntityType; entityId: string; notes?: string; userId: string; scope: WorksiteScope
}) {
  const entityId = args.entityId.trim()
  const notes = args.notes?.trim() || null
  if (entityId.length < 1 || entityId.length > 160) throw new Error("Identificador de entidad inválido.")
  if (notes && notes.length > 1000) throw new Error("Las notas del vínculo superan el máximo permitido.")
  const [document] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, args.documentId)).limit(1)
  if (!document) throw new Error("Documento no encontrado.")
  assertScopeAccess(document.worksiteId, args.scope)
  const target = await resolveDocumentLinkTarget(args.entityType, entityId)
  if (!target) throw new Error("La entidad que intentas vincular no existe.")
  if (target.worksiteId) assertScopeAccess(target.worksiteId, args.scope)
  if (document.worksiteId && target.worksiteId && document.worksiteId !== target.worksiteId) {
    throw new Error("La entidad no pertenece a la faena del documento.")
  }
  const now = new Date().toISOString()
  const [created] = await db.insert(sstDocumentLinks).values({
    id: `sdlink-${nanoid()}`, documentId: args.documentId, entityType: args.entityType, entityId,
    notes, createdByUserId: args.userId, createdAt: now,
  }).onConflictDoNothing().returning()
  if (!created) throw new Error("El documento ya tiene un vínculo activo con esa entidad.")
  await recordAuditEntry({ documentId: args.documentId, userId: args.userId, action: "link", metadata: { entityType: args.entityType, entityId } })
  return created
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
