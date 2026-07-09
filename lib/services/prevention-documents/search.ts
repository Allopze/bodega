import { and, count, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import {
  sstDocuments,
  sstDocumentVersions,
  sstDocumentAudit,
} from "@/db/schema"
import { sstDocumentSearchSchema } from "@/lib/validation/prevention"
import type { SstDocumentSearchInput } from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentStatus,
  type DashboardCounters,
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
  const audit = await db.select().from(sstDocumentAudit).where(eq(sstDocumentAudit.documentId, id)).orderBy(desc(sstDocumentAudit.createdAt)).limit(200)

  const effective = { ...doc, status: effectiveStatus(doc.status as SstDocumentStatus, doc.expiresAt) }
  return { doc: effective, versions, links: [], acks: [], audit }
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

  const statusCountRows = await db
    .select({ status: sstDocuments.status, count: count() })
    .from(sstDocuments)
    .where(and(baseWhere, isNotNull(sstDocuments.status)))
    .groupBy(sstDocuments.status)

  const vigentesRows = await db
    .select({
      expiresAt: sstDocuments.expiresAt,
      requiresAcknowledgment: sstDocuments.requiresAcknowledgment,
      currentVersionId: sstDocuments.currentVersionId,
    })
    .from(sstDocuments)
    .where(and(baseWhere, inArray(sstDocuments.status, ["vigente", "aprobado"])))
    .limit(5000)

  const byStatus: Record<SstDocumentStatus, number> = { borrador: 0, en_revision: 0, observado: 0, aprobado: 0, vigente: 0, vencido: 0, reemplazado: 0, archivado: 0 }

  for (const r of statusCountRows) {
    const s = r.status as SstDocumentStatus
    byStatus[s] = r.count
  }

  const total = statusCountRows.reduce((acc, r) => acc + r.count, 0)
  let expiring7 = 0, expiring15 = 0, expiring30 = 0, ackPending = 0

  for (const d of vigentesRows) {
    const eff = effectiveStatus("vigente" as SstDocumentStatus, d.expiresAt)
    if (eff !== "vigente") {
      byStatus["vigente"] = Math.max(0, byStatus["vigente"] - 1)
      byStatus["vencido"] = (byStatus["vencido"] ?? 0) + 1
    }
    const days = daysUntil(d.expiresAt)
    if (days !== null && eff === "vigente") {
      if (days <= 7) expiring7 += 1
      else if (days <= 15) expiring15 += 1
      else if (days <= 30) expiring30 += 1
    }
    if (d.requiresAcknowledgment && d.currentVersionId && (eff === "vigente" || eff === "vencido")) ackPending += 1
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
