import { and, eq, ne, sql } from "drizzle-orm"
import { promises as fs } from "node:fs"
import { db } from "@/db"
import {
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { resolveSstDocumentFile } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentVersionCreateSchema,
  sstDocumentStatusChangeSchema,
  sstDocumentVersionStatusChangeSchema,
  sstDocumentApproveSchema,
  sstDocumentObserveSchema,
  sstDocumentArchiveSchema,
} from "@/lib/validation/prevention"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentStatus,
  type SstDocumentConfidentiality,
  type RequestContext,
  type CreateDocumentInput,
  type UploadInput,
  assertScopeAccess,
  assertConfidentialityAllowed,
  readFileToBuffer,
  persistFileOnDisk,
  generateStorageName,
  sha256Hex,
  recordAuditEntry,
} from "./utils"

const ALLOWED_MIMES = MimeType.INVOICE
const MAX_FILE_SIZE = 25 * 1024 * 1024

/* ── Creación de documento ──────────────────────────────────────────────── */

export async function createDocument({ data, ctx, scope, permissions }: CreateDocumentInput) {
  const parsed = sstDocumentCreateSchema.parse(data)
  assertScopeAccess(parsed.worksiteId || null, scope)
  assertConfidentialityAllowed(parsed.confidentiality, permissions)

  const now = new Date().toISOString()
  const id = `sdoc-${nanoid()}`

  await db.insert(sstDocuments).values({
    id, categorySlug: parsed.categorySlug, typeId: parsed.typeId || null,
    folderId: parsed.folderId || null,
    internalCode: parsed.internalCode || null, title: parsed.title,
    description: parsed.description || null, worksiteId: parsed.worksiteId || null,
    status: "borrador", confidentiality: parsed.confidentiality,
    currentVersionId: null, effectiveFrom: parsed.effectiveFrom || null,
    expiresAt: parsed.expiresAt || null, responsibleUserId: parsed.responsibleUserId || null,
    uploadedBy: ctx.userId, reviewedBy: null, approvedBy: null, approvedAt: null,
    requiresAcknowledgment: parsed.requiresAcknowledgment ?? false,
    tags: parsed.tags, extraMetadata: parsed.extraMetadata, checksum: null,
    createdAt: now, updatedAt: now,
  })

  const [row] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!row) throw new Error("No se pudo crear el documento.")

  await recordAuditEntry({
    documentId: id, userId: ctx.userId, userEmail: ctx.userEmail,
    action: "create", fromStatus: null, toStatus: "borrador", ip: ctx.ip,
    metadata: { categorySlug: parsed.categorySlug, confidentiality: parsed.confidentiality },
  })
  await recordAudit({
    userId: ctx.userId, userEmail: ctx.userEmail, action: "create",
    entityType: "sst_document", entityId: id,
    entityCode: parsed.internalCode || parsed.title.slice(0, 40),
    newState: { categorySlug: parsed.categorySlug, status: "borrador", confidentiality: parsed.confidentiality },
  })
  return row
}

/* ── Actualización de metadata ──────────────────────────────────────────── */

export async function updateDocumentMetadata(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[]
}) {
  const data = sstDocumentUpdateSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.id))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)
  if (doc.status === "archivado") throw new Error("No se puede modificar un documento archivado.")
  if (data.worksiteId !== undefined) assertScopeAccess(data.worksiteId || null, args.scope)
  if (data.confidentiality !== undefined) assertConfidentialityAllowed(data.confidentiality, args.permissions)

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }
  if (data.title !== undefined) patch.title = data.title
  if (data.folderId !== undefined) patch.folderId = data.folderId || null
  if (data.description !== undefined) patch.description = data.description || null
  if (data.worksiteId !== undefined) patch.worksiteId = data.worksiteId || null
  if (data.confidentiality !== undefined) patch.confidentiality = data.confidentiality
  if (data.effectiveFrom !== undefined) patch.effectiveFrom = data.effectiveFrom || null
  if (data.expiresAt !== undefined) patch.expiresAt = data.expiresAt || null
  if (data.responsibleUserId !== undefined) patch.responsibleUserId = data.responsibleUserId || null
  if (data.requiresAcknowledgment !== undefined) patch.requiresAcknowledgment = data.requiresAcknowledgment
  if (data.internalCode !== undefined) patch.internalCode = data.internalCode || null
  if (data.tags !== undefined) patch.tags = data.tags
  if (data.extraMetadata !== undefined) patch.extraMetadata = data.extraMetadata

  const [updated] = await db.update(sstDocuments).set(patch).where(eq(sstDocuments.id, data.id)).returning()
  if (!updated) throw new Error("No se pudo actualizar el documento.")
  await recordAuditEntry({
    documentId: data.id, userId: args.ctx.userId, userEmail: args.ctx.userEmail,
    action: "edit", ip: args.ctx.ip,
    metadata: { changed: Object.keys(patch).filter((k) => k !== "updatedAt") },
  })
  return updated
}

/* ── Subida de archivo ──────────────────────────────────────────────────── */

export async function uploadDocumentVersion(args: {
  input: UploadInput; ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[]
}) {
  const data = sstDocumentVersionCreateSchema.parse({
    documentId: args.input.documentId, effectiveFrom: args.input.effectiveFrom,
    effectiveTo: args.input.effectiveTo, changelog: args.input.changelog,
    supersedesId: args.input.supersedesId,
  })
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)
  if (doc.status === "archivado") throw new Error("No se puede subir versiones a un documento archivado.")

  const file = await readFileToBuffer(args.input.file)
  if (file.size > MAX_FILE_SIZE) throw new Error(`El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`)
  if (file.size < 4) throw new Error("El archivo está vacío o es demasiado pequeño.")
  const validated = validateFileBuffer(file.buffer, file.size, ALLOWED_MIMES)
  if (validated.error) throw new Error(validated.error)

  const checksum = sha256Hex(file.buffer)
  const [dupe] = await db
    .select({ id: sstDocumentVersions.id, version: sstDocumentVersions.version })
    .from(sstDocumentVersions)
    .where(and(eq(sstDocumentVersions.documentId, data.documentId), eq(sstDocumentVersions.checksum, checksum)))
    .limit(1)
  if (dupe) throw new Error(`Este archivo ya existe como versión ${dupe.version} del documento.`)

  const storageName = generateStorageName(file.name)
  const relativePath = await persistFileOnDisk(storageName, file.buffer)
  const now = new Date().toISOString()
  const id = `sdv-${nanoid()}`

  const [row] = await db.insert(sstDocumentVersions).values({
    id, documentId: data.documentId,
    version: sql`(SELECT COALESCE(MAX(${sstDocumentVersions.version}), 0) + 1 FROM ${sstDocumentVersions} WHERE ${sstDocumentVersions.documentId} = ${data.documentId})`,
    status: "borrador", fileName: file.name, storageName, filePath: relativePath,
    mimeType: validated.mimeType, fileSize: file.size, checksum,
    effectiveFrom: data.effectiveFrom || null, effectiveTo: data.effectiveTo || null,
    changelog: data.changelog || null, uploadedBy: args.ctx.userId,
    reviewedBy: null, approvedBy: null, approvedAt: null,
    supersedesId: data.supersedesId || null, createdAt: now, updatedAt: now,
  }).returning()

  if (!row) {
    try { const abs = resolveSstDocumentFile(relativePath); if (abs) await fs.unlink(abs) }
    catch (err) { logger.warn("[documents-library] no se pudo limpiar archivo huérfano", err) }
    throw new Error("No se pudo registrar la nueva versión.")
  }
  await db.update(sstDocuments).set({ checksum, updatedAt: now }).where(eq(sstDocuments.id, data.documentId))
  await recordAuditEntry({
    documentId: data.documentId, versionId: id, userId: args.ctx.userId, userEmail: args.ctx.userEmail,
    action: "upload", ip: args.ctx.ip, comment: data.changelog || null,
    metadata: { fileName: file.name, size: file.size, mime: validated.mimeType, version: row.version },
  })
  return row
}

/* ── Máquina de estados ─────────────────────────────────────────────────── */

const ALLOWED_DOC_STATUS: Record<SstDocumentStatus, SstDocumentStatus[]> = {
  borrador: ["en_revision", "archivado"],
  en_revision: ["aprobado", "observado", "borrador", "archivado"],
  observado: ["en_revision", "borrador", "archivado"],
  aprobado: ["vigente", "archivado"],
  vigente: ["vencido", "reemplazado", "archivado"],
  vencido: ["vigente", "reemplazado", "archivado"],
  reemplazado: ["archivado"],
  archivado: [],
}

const ALLOWED_VERSION_STATUS: Record<string, SstDocumentStatus[]> = {
  borrador: ["en_revision", "archivado"],
  en_revision: ["aprobado", "observado", "borrador", "archivado"],
  observado: ["en_revision", "borrador", "archivado"],
  aprobado: ["vigente", "archivado"],
  vigente: ["reemplazado", "archivado"],
  reemplazado: ["archivado"],
  archivado: [],
}

export async function changeDocumentStatus(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[]
}) {
  const data = sstDocumentStatusChangeSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const from = doc.status as SstDocumentStatus
  const to = data.toStatus
  if (!ALLOWED_DOC_STATUS[from]?.includes(to)) throw new Error(`Transición inválida: ${from} → ${to}.`)

  if (to === "aprobado" || to === "vigente") {
    if (!doc.currentVersionId) throw new Error("No se puede aprobar/vigentar un documento sin versión aprobada.")
    const [ver] = await db.select({ status: sstDocumentVersions.status }).from(sstDocumentVersions).where(eq(sstDocumentVersions.id, doc.currentVersionId)).limit(1)
    if (!ver) throw new Error("La versión vigente no existe.")
    if (to === "aprobado" && !["aprobado", "vigente"].includes(ver.status)) throw new Error("La versión actual debe estar aprobada antes que el documento.")
    if (to === "vigente" && ver.status !== "aprobado") throw new Error("La versión actual debe estar aprobada para marcar el documento como vigente.")
  }

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocuments).set({ status: to, updatedAt: now }).where(eq(sstDocuments.id, data.documentId)).returning()
  if (!updated) throw new Error("No se pudo actualizar el estado del documento.")

  await recordStatusChange({ entityType: "sst_document", entityId: data.documentId, fromStatus: from, toStatus: to, changedBy: args.ctx.userId, reason: data.comment })
  await recordAuditEntry({ documentId: data.documentId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "status_change", fromStatus: from, toStatus: to, comment: data.comment || null, ip: args.ctx.ip })
  return updated
}

export async function changeVersionStatus(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentVersionStatusChangeSchema.parse(args.input)
  const [ver] = await db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.id, data.versionId)).limit(1)
  if (!ver) throw new Error("Versión no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, ver.documentId)).limit(1)
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const from = ver.status as SstDocumentStatus
  const to = data.toStatus as SstDocumentStatus
  if (!ALLOWED_VERSION_STATUS[from]?.includes(to)) throw new Error(`Transición inválida: ${from} → ${to}.`)

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocumentVersions)
    .set({ status: to, updatedAt: now, approvedBy: to === "aprobado" || to === "vigente" ? args.ctx.userId : ver.approvedBy, approvedAt: to === "aprobado" || to === "vigente" ? now : ver.approvedAt })
    .where(eq(sstDocumentVersions.id, data.versionId)).returning()
  if (!updated) throw new Error("No se pudo actualizar la versión.")

  if (to === "vigente") {
    await db.update(sstDocuments).set({ currentVersionId: ver.id, updatedAt: now, checksum: ver.checksum }).where(eq(sstDocuments.id, ver.documentId))
    if (doc.currentVersionId && doc.currentVersionId !== ver.id) {
      await db.update(sstDocumentVersions).set({ status: "reemplazado", effectiveTo: now.slice(0, 10), updatedAt: now }).where(and(eq(sstDocumentVersions.id, doc.currentVersionId), ne(sstDocumentVersions.id, ver.id)))
    }
  }

  await recordAuditEntry({ documentId: ver.documentId, versionId: ver.id, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "status_change", fromStatus: from, toStatus: to, comment: data.comment || null, ip: args.ctx.ip })
  return updated
}

/* ── Aprobación y observación ───────────────────────────────────────────── */

export async function approveCurrentVersion(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentApproveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const targetVersionId = data.versionId || doc.currentVersionId
  if (!targetVersionId) throw new Error("No hay versión para aprobar. Sube un archivo primero.")

  await changeVersionStatus({ input: { versionId: targetVersionId, toStatus: "aprobado", comment: data.comment }, ctx: args.ctx, scope: args.scope })
  await changeVersionStatus({ input: { versionId: targetVersionId, toStatus: "vigente", comment: data.comment }, ctx: args.ctx, scope: args.scope })

  if (["en_revision", "observado", "borrador", "aprobado"].includes(doc.status)) {
    await changeDocumentStatus({ input: { documentId: data.documentId, toStatus: "vigente", comment: data.comment || "Aprobado y vigente" }, ctx: args.ctx, scope: args.scope, permissions: [] })
  }

  await recordAuditEntry({ documentId: data.documentId, versionId: targetVersionId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "approve", comment: data.comment || null, ip: args.ctx.ip })
  const [updated] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  return updated
}

export async function observeDocument(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentObserveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const targetVersionId = data.versionId || doc.currentVersionId
  if (targetVersionId) {
    await changeVersionStatus({ input: { versionId: targetVersionId, toStatus: "observado", comment: data.comment }, ctx: args.ctx, scope: args.scope })
  }
  const from = doc.status as SstDocumentStatus
  if (from !== "observado") {
    await changeDocumentStatus({ input: { documentId: data.documentId, toStatus: "observado", comment: data.comment }, ctx: args.ctx, scope: args.scope, permissions: [] })
  }
  await recordAuditEntry({ documentId: data.documentId, versionId: targetVersionId || null, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "observe", comment: data.comment, ip: args.ctx.ip })
  return { observed: true }
}

/* ── Archivado lógico ───────────────────────────────────────────────────── */

export async function archiveDocument(args: {
  input: unknown; ctx: RequestContext; scope: WorksiteScope
}) {
  const data = sstDocumentArchiveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocuments).set({ status: "archivado", updatedAt: now }).where(eq(sstDocuments.id, data.documentId)).returning()
  if (!updated) throw new Error("No se pudo archivar el documento.")
  await db.update(sstDocumentVersions).set({ status: "archivado", updatedAt: now }).where(and(eq(sstDocumentVersions.documentId, data.documentId), ne(sstDocumentVersions.status, "vigente"), ne(sstDocumentVersions.status, "aprobado")))
  await recordAuditEntry({ documentId: data.documentId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "archive", comment: data.comment || null, ip: args.ctx.ip })
  return updated
}

export async function restoreDocument(args: {
  input: { documentId: string; comment?: string }; ctx: RequestContext; scope: WorksiteScope
}) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, args.input.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  if (doc.status !== "archivado") throw new Error("Sólo se pueden restaurar documentos archivados.")

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocuments)
    .set({ status: "borrador", updatedAt: now })
    .where(eq(sstDocuments.id, args.input.documentId))
    .returning()
  if (!updated) throw new Error("No se pudo restaurar el documento.")
  await recordStatusChange({
    entityType: "sst_document",
    entityId: args.input.documentId,
    fromStatus: "archivado",
    toStatus: "borrador",
    changedBy: args.ctx.userId,
    reason: args.input.comment || "Restaurado desde biblioteca documental",
  })
  await recordAuditEntry({
    documentId: args.input.documentId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "status_change",
    fromStatus: "archivado",
    toStatus: "borrador",
    comment: args.input.comment || null,
    ip: args.ctx.ip,
  })
  return updated
}

/* ── Lectura ────────────────────────────────────────────────────────────── */

export async function getDocumentById(id: string) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  return doc
}

export async function getVersionById(id: string) {
  const [ver] = await db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.id, id))
  return ver
}
