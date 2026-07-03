import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocuments,
  sstDocumentVersions,
  sstDocumentLinks,
  sstDocumentAcknowledgments,
  sstDocumentAudit,
} from "@/db/schema"
import { sstDocumentSearchSchema } from "@/lib/validation/prevention"
import type { SstDocumentSearchInput } from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentStatus,
  type DashboardCounters,
  type ExpiringDocument,
  assertScopeAccess,
  effectiveStatus,
  daysUntil,
  recordAuditEntry,
} from "./utils"

/* ── Lectura: documento completo (bundle) ───────────────────────────────── */

export async function getDocumentBundle(id: string, scope: WorksiteScope) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!doc) return null
  assertScopeAccess(doc.worksiteId, scope)

  const versions = await db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.documentId, id)).orderBy(desc(sstDocumentVersions.version))
  const links = await db.select().from(sstDocumentLinks).where(eq(sstDocumentLinks.documentId, id))
  const acks = versions.length === 0 ? [] : await db.select({
    id: sstDocumentAcknowledgments.id, versionId: sstDocumentAcknowledgments.versionId,
    userId: sstDocumentAcknowledgments.userId, method: sstDocumentAcknowledgments.method,
    signature: sstDocumentAcknowledgments.signature, ip: sstDocumentAcknowledgments.ip,
    acknowledgedAt: sstDocumentAcknowledgments.acknowledgedAt,
  }).from(sstDocumentAcknowledgments).where(inArray(sstDocumentAcknowledgments.versionId, versions.map((v) => v.id)))
  const audit = await db.select().from(sstDocumentAudit).where(eq(sstDocumentAudit.documentId, id)).orderBy(desc(sstDocumentAudit.createdAt)).limit(200)

  const effective = { ...doc, status: effectiveStatus(doc.status as SstDocumentStatus, doc.expiresAt) }
  return { doc: effective, versions, links, acks, audit }
}

/* ── Búsqueda ───────────────────────────────────────────────────────────── */

export async function searchDocuments(input: SstDocumentSearchInput, scope: WorksiteScope) {
  const data = sstDocumentSearchSchema.parse(input)
  const conditions: (SQL | undefined)[] = []

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

  if (data.entityType && data.entityId) {
    const docIds = await db.select({ documentId: sstDocumentLinks.documentId }).from(sstDocumentLinks).where(and(eq(sstDocumentLinks.entityType, data.entityType), eq(sstDocumentLinks.entityId, data.entityId)))
    if (docIds.length === 0) return { rows: [], total: 0 }
    conditions.push(inArray(sstDocuments.id, docIds.map((d) => d.documentId)))
  } else if (data.entityType) {
    const docIds = await db.select({ documentId: sstDocumentLinks.documentId }).from(sstDocumentLinks).where(eq(sstDocumentLinks.entityType, data.entityType))
    if (docIds.length === 0) return { rows: [], total: 0 }
    conditions.push(inArray(sstDocuments.id, docIds.map((d) => d.documentId)))
  }

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

export async function getDashboardCounters(scope: WorksiteScope): Promise<DashboardCounters> {
  const baseWhere = scope.mode === "some"
    ? or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))
    : undefined

  const all = await db
    .select({ id: sstDocuments.id, status: sstDocuments.status, expiresAt: sstDocuments.expiresAt, currentVersionId: sstDocuments.currentVersionId, requiresAcknowledgment: sstDocuments.requiresAcknowledgment })
    .from(sstDocuments).where(baseWhere)

  const byStatus: Record<SstDocumentStatus, number> = { borrador: 0, en_revision: 0, observado: 0, aprobado: 0, vigente: 0, vencido: 0, reemplazado: 0, archivado: 0 }
  let expiring7 = 0, expiring15 = 0, expiring30 = 0, ackPending = 0

  for (const d of all) {
    const eff = effectiveStatus(d.status as SstDocumentStatus, d.expiresAt)
    byStatus[eff] = (byStatus[eff] ?? 0) + 1
    const days = daysUntil(d.expiresAt)
    if (days !== null && eff === "vigente") {
      if (days <= 7) expiring7 += 1
      else if (days <= 15) expiring15 += 1
      else if (days <= 30) expiring30 += 1
    }
    if (d.requiresAcknowledgment && d.currentVersionId && (eff === "vigente" || eff === "vencido")) ackPending += 1
  }

  return {
    total: all.length, byStatus,
    expiringSoon: { within7: expiring7, within15: expiring15, within30: expiring30 },
    pendingReview: byStatus.en_revision, observed: byStatus.observado, ackPending,
  }
}

export async function getExpiringDocuments(scope: WorksiteScope, daysAhead = 30, limit = 200): Promise<ExpiringDocument[]> {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const whereParts = [isNotNull(sstDocuments.expiresAt), lte(sstDocuments.expiresAt, target), ne(sstDocuments.status, "archivado"), ne(sstDocuments.status, "reemplazado")]
  if (scope.mode === "some") {
    const scoped = or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))
    if (scoped) whereParts.push(scoped)
  }
  const rows = await db.select({
    id: sstDocuments.id, title: sstDocuments.title, internalCode: sstDocuments.internalCode,
    status: sstDocuments.status, expiresAt: sstDocuments.expiresAt, worksiteId: sstDocuments.worksiteId,
    categorySlug: sstDocuments.categorySlug, responsibleUserId: sstDocuments.responsibleUserId,
  }).from(sstDocuments).where(and(...whereParts)).orderBy(sstDocuments.expiresAt).limit(limit)

  return rows.map((r) => ({ ...r, status: effectiveStatus(r.status as SstDocumentStatus, r.expiresAt), daysRemaining: daysUntil(r.expiresAt) }))
}

/* ── Bandeja de revisión ────────────────────────────────────────────────── */

export async function listReviewQueue(scope: WorksiteScope) {
  const whereParts = [or(eq(sstDocuments.status, "en_revision"), eq(sstDocuments.status, "observado"))]
  if (scope.mode === "some") whereParts.push(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId)))
  return db.select().from(sstDocuments).where(and(...whereParts)).orderBy(desc(sstDocuments.updatedAt)).limit(100)
}

/* ── Tracking de visualizaciones y descargas ────────────────────────────── */

export async function recordDocumentView(args: { documentId: string; versionId?: string | null; userId: string; source?: string; ip?: string | null }) {
  await recordAuditEntry({ documentId: args.documentId, versionId: args.versionId ?? null, userId: args.userId, action: "view", metadata: { source: args.source ?? "api" }, ip: args.ip ?? null })
}

export async function recordDocumentDownload(args: { documentId: string; versionId?: string | null; userId: string; source?: string; ip?: string | null }) {
  await recordAuditEntry({ documentId: args.documentId, versionId: args.versionId ?? null, userId: args.userId, action: "download", metadata: { source: args.source ?? "api" }, ip: args.ip ?? null })
}
