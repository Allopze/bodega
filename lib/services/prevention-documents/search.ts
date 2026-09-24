import { and, count, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocuments,
  sstDocumentLinks,
  sstDocumentVersions,
  sstDocumentAudit,
  sstDocumentAcknowledgments,
  sstDocumentDistributionTargets,
} from "@/db/schema"
import { sstDocumentSearchSchema } from "@/lib/validation/prevention"
import type { SstDocumentSearchInput } from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentStatus,
  type DashboardCounters,
  effectiveStatus,
  daysUntil,
  recordAuditEntry,
  allowedDocumentConfidentialities,
  canReadDocumentConfidentiality,
} from "./utils"

/* ── Lectura: documento completo (bundle) ───────────────────────────────── */

export async function getDocumentBundle(id: string, scope: WorksiteScope, permissions: readonly string[] = []) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!doc) return null
  if (scope.mode === "none") return null
  // Un documento corporativo (sin faena) es de toda la empresa —el RIOHS—, y
  // quien opera una faena tiene que poder abrirlo para distribuirlo y acusarlo
  // en ella. El listado y la descarga ya lo permitían; el detalle era el único
  // que lo negaba. Lo que sí se acota es la distribución: ver abajo.
  if (scope.mode === "some" && doc.worksiteId && !scope.ids.includes(doc.worksiteId)) return null
  if (!canReadDocumentConfidentiality(doc.confidentiality, permissions)) return null

  const [versions, links, acks, distribution, audit] = await Promise.all([
    db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.documentId, id)).orderBy(desc(sstDocumentVersions.version)),
    db.select().from(sstDocumentLinks).where(and(eq(sstDocumentLinks.documentId, id), isNull(sstDocumentLinks.removedAt))),
    db.select({
      id: sstDocumentAcknowledgments.id,
      versionId: sstDocumentAcknowledgments.versionId,
      userId: sstDocumentAcknowledgments.userId,
      signature: sstDocumentAcknowledgments.signature,
      acknowledgedAt: sstDocumentAcknowledgments.acknowledgedAt,
    }).from(sstDocumentAcknowledgments)
      .innerJoin(sstDocumentVersions, eq(sstDocumentAcknowledgments.versionId, sstDocumentVersions.id))
      .where(eq(sstDocumentVersions.documentId, id)),
    db.select().from(sstDocumentDistributionTargets)
      .innerJoin(sstDocumentVersions, eq(sstDocumentDistributionTargets.versionId, sstDocumentVersions.id))
      .where(eq(sstDocumentVersions.documentId, id)),
    db.select().from(sstDocumentAudit).where(eq(sstDocumentAudit.documentId, id)).orderBy(desc(sstDocumentAudit.createdAt)).limit(200),
  ])

  const effective = { ...doc, status: effectiveStatus(doc.status as SstDocumentStatus, doc.expiresAt) }
  let targets = distribution.map((row) => row.sst_document_distribution_targets)
  let visibleAcks = acks
  // En un documento corporativo, un usuario con alcance de faena ve sólo la
  // distribución de sus faenas: quién acusó en otra faena no le corresponde.
  if (scope.mode === "some" && !doc.worksiteId) {
    targets = targets.filter((target) => target.worksiteId !== null && scope.ids.includes(target.worksiteId))
    const visibleUsers = new Set(targets.flatMap((target) => target.userId ? [target.userId] : []))
    visibleAcks = acks.filter((ack) => visibleUsers.has(ack.userId))
  }
  return {
    doc: effective,
    versions,
    links,
    acks: visibleAcks,
    distribution: targets,
    audit,
  }
}

/* ── Búsqueda ───────────────────────────────────────────────────────────── */

export async function searchDocuments(input: SstDocumentSearchInput, scope: WorksiteScope, permissions: readonly string[] = []) {
  const data = sstDocumentSearchSchema.parse(input)
  if (scope.mode === "none") return { rows: [], total: 0 }
  const conditions: (SQL | undefined)[] = []
  conditions.push(inArray(sstDocuments.confidentiality, allowedDocumentConfidentialities(permissions)))

  if (data.q) {
    const q = `%${data.q.replace(/[%_]/g, (m) => `\\${m}`)}%`
    conditions.push(or(like(sstDocuments.title, q), like(sstDocuments.internalCode, q), like(sstDocuments.description, q)))
  }
  if (data.folderId !== undefined) {
    if (data.folderId) conditions.push(eq(sstDocuments.folderId, data.folderId))
    else conditions.push(isNull(sstDocuments.folderId))
  }
  if (data.categorySlug) conditions.push(eq(sstDocuments.categorySlug, data.categorySlug))
  if (data.status) conditions.push(eq(sstDocuments.status, data.status))
  if (data.confidentiality) conditions.push(eq(sstDocuments.confidentiality, data.confidentiality))
  if (data.worksiteId) conditions.push(eq(sstDocuments.worksiteId, data.worksiteId))
  if (data.responsibleUserId) conditions.push(eq(sstDocuments.responsibleUserId, data.responsibleUserId))
  if (data.expiresBefore) conditions.push(lte(sstDocuments.expiresAt, data.expiresBefore))
  if (data.expiresAfter) conditions.push(gte(sstDocuments.expiresAt, data.expiresAfter))

  if (scope.mode === "some") {
    conditions.push(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId)))
  }

  const where = conditions.length ? and(...conditions) : undefined
  const offset = (data.page - 1) * data.pageSize

  const [rows, totalRow] = await Promise.all([
    db.select().from(sstDocuments).where(where).orderBy(desc(sstDocuments.updatedAt)).limit(data.pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(sstDocuments).where(where),
  ])

  const effectiveRows = rows.map((r) => ({ ...r, status: effectiveStatus(r.status as SstDocumentStatus, r.expiresAt) }))
  return { rows: effectiveRows, total: Number(totalRow[0]?.count ?? 0) }
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */

export async function getDashboardCounters(scope: WorksiteScope, permissions: readonly string[] = []): Promise<DashboardCounters> {
  if (scope.mode === "none") {
    return {
      total: 0,
      byStatus: { borrador: 0, en_revision: 0, observado: 0, aprobado: 0, vigente: 0, vencido: 0, reemplazado: 0, archivado: 0 },
      expiringSoon: { within7: 0, within15: 0, within30: 0 },
      pendingReview: 0,
      observed: 0,
      ackPending: 0,
    }
  }
  const confidentialityWhere = inArray(
    sstDocuments.confidentiality,
    allowedDocumentConfidentialities(permissions),
  )
  const baseWhere = scope.mode === "some"
    ? and(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId)), confidentialityWhere)
    : confidentialityWhere

  const [statusCountRows, vigentesRows, ackPendingRows] = await Promise.all([
    db.select({ status: sstDocuments.status, count: count() })
      .from(sstDocuments)
      .where(and(baseWhere, isNotNull(sstDocuments.status)))
      .groupBy(sstDocuments.status),
    db.select({
      status: sstDocuments.status,
      expiresAt: sstDocuments.expiresAt,
      requiresAcknowledgment: sstDocuments.requiresAcknowledgment,
      currentVersionId: sstDocuments.currentVersionId,
    })
      .from(sstDocuments)
      .where(and(baseWhere, inArray(sstDocuments.status, ["vigente", "aprobado"])))
      .limit(5000),
    db.select({ count: sql<number>`count(*)::int` })
      .from(sstDocumentDistributionTargets)
      .innerJoin(sstDocumentVersions, eq(sstDocumentVersions.id, sstDocumentDistributionTargets.versionId))
      .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentVersions.documentId))
      .where(and(
        baseWhere,
        eq(sstDocumentDistributionTargets.status, "pendiente"),
        eq(sstDocumentVersions.status, "vigente"),
        eq(sstDocuments.currentVersionId, sstDocumentVersions.id),
      )),
  ])
  const [ackPendingRow] = ackPendingRows

  const byStatus: Record<SstDocumentStatus, number> = { borrador: 0, en_revision: 0, observado: 0, aprobado: 0, vigente: 0, vencido: 0, reemplazado: 0, archivado: 0 }

  for (const r of statusCountRows) {
    const s = r.status as SstDocumentStatus
    byStatus[s] = r.count
  }

  const total = statusCountRows.reduce((acc, r) => acc + r.count, 0)
  let expiring7 = 0, expiring15 = 0, expiring30 = 0
  const ackPending = Number(ackPendingRow?.count ?? 0)

  for (const d of vigentesRows) {
    const days = daysUntil(d.expiresAt)
    const expired = days !== null && days < 0
    // La query trae vigentes Y aprobados (ambos pueden estar por vencer); el
    // traspaso vigente→vencido solo corresponde a filas realmente vigentes —
    // moverlo para un "aprobado" vencido creaba un "vencido" fantasma.
    if (expired && d.status === "vigente") {
      byStatus["vigente"] = Math.max(0, byStatus["vigente"] - 1)
      byStatus["vencido"] = (byStatus["vencido"] ?? 0) + 1
    }
    if (days !== null && !expired) {
      if (days <= 7) expiring7 += 1
      else if (days <= 15) expiring15 += 1
      else if (days <= 30) expiring30 += 1
    }
  }

  return {
    total, byStatus,
    expiringSoon: { within7: expiring7, within15: expiring15, within30: expiring30 },
    pendingReview: byStatus.en_revision, observed: byStatus.observado, ackPending,
  }
}

/* ── Tracking de visualizaciones y descargas ────────────────────────────── */

export async function recordDocumentView(args: { documentId: string; versionId?: string | null; userId: string; source?: string; ip?: string | null }) {
  await recordAuditEntry({ documentId: args.documentId, versionId: args.versionId ?? null, userId: args.userId, action: "view", metadata: { source: args.source ?? "api" }, ip: args.ip ?? null })
}

export async function recordDocumentDownload(args: { documentId: string; versionId?: string | null; userId: string; source?: string; ip?: string | null }) {
  await recordAuditEntry({ documentId: args.documentId, versionId: args.versionId ?? null, userId: args.userId, action: "download", metadata: { source: args.source ?? "api" }, ip: args.ip ?? null })
}
