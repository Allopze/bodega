import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocuments,
  sstDocumentVersions,
  sstDocumentLinks,
  sstDocumentAcknowledgments,
  users,
  worksites,
  workers,
  fuelVehicles,
  preventionIncidents,
  trainingCourses,
  committees,
  eppRecambioLog,
  equipmentDailyReports,
  preventionIncidentActions,
  emergencyPlans,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  sstDocumentLinkSchema,
  sstDocumentUnlinkSchema,
  sstDocumentAckSchema,
  SST_DOCUMENT_LINK_ENTITY_TYPES,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentStatus,
  type RequestContext,
  assertScopeAccess,
  recordAuditEntry,
} from "./utils"

type SstDocumentLinkEntityType = (typeof SST_DOCUMENT_LINK_ENTITY_TYPES)[number]

async function assertLinkedEntityAccess(
  entityType: SstDocumentLinkEntityType,
  entityId: string,
  scope: WorksiteScope,
) {
  if (entityType === "worksite") {
    const [row] = await db.select({ worksiteId: worksites.id }).from(worksites).where(eq(worksites.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "worker") {
    const [row] = await db.select({ worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "vehicle") {
    const [row] = await db.select({ worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles).where(eq(fuelVehicles.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "equipment") {
    const [row] = await db.select({ worksiteId: equipmentDailyReports.worksiteId }).from(equipmentDailyReports).where(eq(equipmentDailyReports.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "incident") {
    const [row] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents).where(eq(preventionIncidents.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "training") {
    const [row] = await db.select({ id: trainingCourses.id }).from(trainingCourses).where(eq(trainingCourses.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    return
  }
  if (entityType === "committee") {
    const [row] = await db.select({ worksiteId: committees.worksiteId }).from(committees).where(eq(committees.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
    return
  }
  if (entityType === "epp_delivery") {
    const [delivery] = await db.select({ workerId: eppRecambioLog.workerId }).from(eppRecambioLog).where(eq(eppRecambioLog.id, entityId))
    if (!delivery) throw new Error("Entidad vinculada no encontrada.")
    const [worker] = await db.select({ worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, delivery.workerId))
    if (!worker) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(worker.worksiteId, scope)
    return
  }
  if (entityType === "corrective_action") {
    const [action] = await db.select({ incidentId: preventionIncidentActions.incidentId }).from(preventionIncidentActions).where(eq(preventionIncidentActions.id, entityId))
    if (!action) throw new Error("Entidad vinculada no encontrada.")
    const [incident] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents).where(eq(preventionIncidents.id, action.incidentId))
    if (!incident) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(incident.worksiteId, scope)
    return
  }
  if (entityType === "emergency_plan") {
    const [row] = await db.select({ worksiteId: emergencyPlans.worksiteId }).from(emergencyPlans).where(eq(emergencyPlans.id, entityId))
    if (!row) throw new Error("Entidad vinculada no encontrada.")
    assertScopeAccess(row.worksiteId, scope)
  }
}

export async function linkDocumentToEntity(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentLinkSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  await assertLinkedEntityAccess(data.entityType, data.entityId, args.scope)

  const now = new Date().toISOString()
  const id = `sdlink-${nanoid()}`
  await db.insert(sstDocumentLinks).values({ id, documentId: data.documentId, entityType: data.entityType, entityId: data.entityId, notes: data.notes || null, createdAt: now }).onConflictDoNothing()
  await recordAuditEntry({ documentId: data.documentId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "link", ip: args.ctx.ip, metadata: { entityType: data.entityType, entityId: data.entityId } })
  return { id }
}

export async function unlinkDocumentEntity(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentUnlinkSchema.parse(args.input)
  const [link] = await db.select().from(sstDocumentLinks).where(eq(sstDocumentLinks.id, data.linkId))
  if (!link) throw new Error("Asociación no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, link.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  await db.delete(sstDocumentLinks).where(eq(sstDocumentLinks.id, data.linkId))
  await recordAuditEntry({ documentId: link.documentId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "unlink", ip: args.ctx.ip, metadata: { entityType: link.entityType, entityId: link.entityId } })
  return { ok: true }
}

export async function acknowledgeVersion(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentAckSchema.parse(args.input)
  const [ver] = await db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.id, data.versionId))
  if (!ver) throw new Error("Versión no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, ver.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const now = new Date().toISOString()
  const id = `sdack-${nanoid()}`
  await db.insert(sstDocumentAcknowledgments).values({
    id, versionId: data.versionId, userId: args.ctx.userId, method: "digital",
    signature: data.signature, ip: args.ctx.ip ?? null, userAgent: args.ctx.userAgent ?? null,
    acknowledgedAt: now,
  }).onConflictDoUpdate({
    target: [sstDocumentAcknowledgments.versionId, sstDocumentAcknowledgments.userId],
    set: { signature: data.signature, ip: args.ctx.ip ?? null, userAgent: args.ctx.userAgent ?? null, acknowledgedAt: now },
  })
  await recordAuditEntry({ documentId: ver.documentId, versionId: ver.id, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "ack", ip: args.ctx.ip })
  return { ok: true }
}
