/**
 * lib/services/prevention-documents-library.ts
 *
 * Servicio de la Biblioteca Documental Preventiva (módulo SST).
 *
 * Alcance: documentación INTERNA de la empresa. NO incluye contratistas
 * (ese flujo vive en lib/services/prevention-contractors.ts y se mantiene
 * intacto por restricción de alcance del módulo).
 *
 * Responsabilidades del servicio:
 *   - CRUD de documentos con taxonomía (categoría + tipo).
 *   - Versionado real: cada nueva versión referencia la anterior y
 *     mantiene el archivo anterior como histórico.
 *   - Máquina de estados documental:
 *       borrador -> en_revision -> (observado | aprobado) -> vigente -> (vencido | reemplazado | archivado)
 *   - Aprobación, observación con comentario obligatorio y acuse de
 *     lectura por usuario.
 *   - Asociación many-to-many con entidades internas (trabajador, faena,
 *     vehículo, equipo, incidente, capacitación, comité, EPP, acción
 *     correctiva, plan de emergencia). Las asociaciones se modelan como
 *     links y el caller garantiza la integridad referencial semántica.
 *   - Bitácora de auditoría por documento.
 *
 * Decisiones de diseño:
 *   - Sin archivos binarios versionados en BD: se persiguen en disco bajo
 *     `storage/sst-documents/` y se valida con magic bytes (mismo patrón
 *     que flota/compras).
 *   - Checksum SHA-256 por versión para detectar duplicados.
 *   - Borrado = archivado (soft delete) para conservar trazabilidad.
 *   - `currentVersionId` se actualiza cuando una versión pasa a 'vigente'.
 *   - Worksite scope: los usuarios con permiso global ven todo; los
 *     prevencionistas de faena solo ven documentos de sus faenas (igual
 *     que en IPER, IPER.incidents, etc.).
 */

import { and, desc, eq, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm"
import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import { join, extname } from "node:path"
import { db } from "@/db"
import {
  sstDocumentCategories,
  sstDocumentTypes,
  sstDocuments,
  sstDocumentVersions,
  sstDocumentLinks,
  sstDocumentAcknowledgments,
  sstDocumentAudit,
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
  type SstDocument,
  type SstDocumentVersion,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import {
  resolveSstDocumentFile,
  resolveSstDocumentsDir,
  createSstDocumentPath,
} from "@/lib/storage/config"
import { validateFileBuffer, MimeType, type MimeTypeSet } from "@/lib/file-validation"
import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentVersionCreateSchema,
  sstDocumentStatusChangeSchema,
  sstDocumentVersionStatusChangeSchema,
  sstDocumentApproveSchema,
  sstDocumentObserveSchema,
  sstDocumentArchiveSchema,
  sstDocumentLinkSchema,
  sstDocumentUnlinkSchema,
  sstDocumentAckSchema,
  sstDocumentSearchSchema,
  sstDocumentCategoryUpsertSchema,
  sstDocumentTypeUpsertSchema,
  SST_DOCUMENT_LINK_ENTITY_TYPES,
  type SstDocumentSearchInput,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import { recordAudit, recordStatusChange } from "@/lib/audit"

/* ── Constantes de operación ────────────────────────────────────────────── */

const ALLOWED_MIMES: MimeTypeSet = MimeType.INVOICE
/** 25 MB por archivo — cubre PDFs con imágenes embebidas y fotos de evidencia. */
const MAX_FILE_SIZE = 25 * 1024 * 1024
/** Umbrales de alerta (días). El dashboard los usa para pintar "Próximo a vencer". */
export const EXPIRY_ALERT_THRESHOLDS = [30, 15, 7] as const

/* ── Tipos públicos ─────────────────────────────────────────────────────── */

export type SstDocumentStatus =
  | "borrador"
  | "en_revision"
  | "observado"
  | "aprobado"
  | "vigente"
  | "vencido"
  | "reemplazado"
  | "archivado"

export type SstDocumentConfidentiality =
  | "publico_interno"
  | "restringido"
  | "sensible"

type SstDocumentLinkEntityType = (typeof SST_DOCUMENT_LINK_ENTITY_TYPES)[number]

export interface UploadInput {
  documentId: string
  file:        File | { name: string; type: string; size: number; buffer: Uint8Array }
  effectiveFrom?: string
  effectiveTo?:   string
  changelog?:     string
  supersedesId?:  string
}

export type DocumentWithCurrent = SstDocument
export type DocumentVersionRow = SstDocumentVersion

export interface RequestContext {
  userId: string
  userEmail?: string
  ip?: string
  userAgent?: string
}

/* ── Helpers internos ───────────────────────────────────────────────────── */

function assertScopeAccess(worksiteId: string | null, scope: WorksiteScope) {
  if (scope.mode === "all") return
  if (!worksiteId) {
    throw new Error("El documento no tiene faena asignada; requiere alcance global.")
  }
  if (scope.mode === "none" || !scope.ids.includes(worksiteId)) {
    throw new Error("Documento no encontrado o sin acceso a la faena.")
  }
}

function assertConfidentialityAllowed(
  confidentiality: SstDocumentConfidentiality,
  userPermissions: readonly string[],
) {
  if (confidentiality === "publico_interno") return
  if (confidentiality === "sensible" && !userPermissions.includes("prevention:docs:manage_sensitive")) {
    throw new Error("No tienes permisos para gestionar documentos sensibles.")
  }
  if (confidentiality === "restringido" && !userPermissions.includes("prevention:docs:manage_restricted")) {
    throw new Error("No tienes permisos para gestionar documentos restringidos.")
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null
  const target = new Date(`${dateIso}T00:00:00Z`).getTime()
  if (Number.isNaN(target)) return null
  const now = Date.now()
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24))
}

function effectiveStatus(
  docStatus: SstDocumentStatus,
  expiresAt: string | null | undefined,
): SstDocumentStatus {
  if (docStatus === "vigente" && expiresAt) {
    const d = daysUntil(expiresAt)
    if (d !== null && d < 0) return "vencido"
  }
  return docStatus
}

function generateStorageName(originalName: string): string {
  const ext = extname(originalName).toLowerCase()
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ""
  return `${nanoid(20)}${safeExt}`
}

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function readFileToBuffer(file: File | { name: string; type: string; size: number; buffer: Uint8Array }): Promise<{ name: string; type: string; size: number; buffer: Uint8Array }> {
  if ("buffer" in file) {
    return { name: file.name, type: file.type, size: file.size, buffer: file.buffer }
  }
  // Web File API
  const buffer = new Uint8Array(await file.arrayBuffer())
  return { name: file.name, type: file.type, size: file.size, buffer }
}

async function persistFileOnDisk(
  storageName: string,
  buffer: Uint8Array,
): Promise<string> {
  const dir = resolveSstDocumentsDir()
  await mkdirp(dir)
  const absolutePath = join(dir, storageName)
  await writeBuffer(absolutePath, Buffer.from(buffer))
  return createSstDocumentPath(storageName)
}

async function recordAuditEntry(args: {
  documentId: string
  versionId?: string | null
  userId?: string | null
  userEmail?: string
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  comment?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
}) {
  const now = new Date().toISOString()
  await db.insert(sstDocumentAudit).values({
    id: `sda-${nanoid()}`,
    documentId: args.documentId,
    versionId: args.versionId ?? null,
    userId: args.userId ?? null,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    action: args.action,
    comment: args.comment ?? null,
    metadata: args.metadata ?? null,
    ip: args.ip ?? null,
    createdAt: now,
  })
}

/* ── Listados de taxonomía (categorías / tipos) ─────────────────────────── */

export async function listDocumentCategories(activeOnly = false) {
  const rows = activeOnly
    ? await db.select().from(sstDocumentCategories).where(eq(sstDocumentCategories.isActive, true))
    : await db.select().from(sstDocumentCategories)
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export async function listDocumentTypes(categorySlug?: string) {
  if (categorySlug) {
    return db
      .select()
      .from(sstDocumentTypes)
      .where(and(eq(sstDocumentTypes.categorySlug, categorySlug), eq(sstDocumentTypes.isActive, true)))
      .orderBy(sstDocumentTypes.name)
  }
  return db.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.isActive, true)).orderBy(sstDocumentTypes.name)
}

export async function upsertDocumentCategory(input: unknown) {
  const data = sstDocumentCategoryUpsertSchema.parse(input)
  const now = new Date().toISOString()
  await db.insert(sstDocumentCategories).values({
    slug: data.slug,
    name: data.name,
    description: data.description || null,
    sortOrder: data.sortOrder,
    isActive: data.isActive,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: sstDocumentCategories.slug,
    set: { name: data.name, description: data.description || null, sortOrder: data.sortOrder, isActive: data.isActive, updatedAt: now },
  })
  const [row] = await db.select().from(sstDocumentCategories).where(eq(sstDocumentCategories.slug, data.slug))
  return row
}

export async function upsertDocumentType(input: unknown) {
  const data = sstDocumentTypeUpsertSchema.parse(input)
  const now = new Date().toISOString()
  const id = data.id || `sdtype-${nanoid()}`
  await db.insert(sstDocumentTypes).values({
    id,
    categorySlug: data.categorySlug,
    code: data.code,
    name: data.name,
    description: data.description || null,
    defaultConfidentiality: data.defaultConfidentiality,
    defaultValidityMonths: data.defaultValidityMonths ?? null,
    requiresApproval: data.requiresApproval,
    requiresAcknowledgment: data.requiresAcknowledgment,
    isActive: data.isActive,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: sstDocumentTypes.id,
    set: {
      categorySlug: data.categorySlug,
      code: data.code,
      name: data.name,
      description: data.description || null,
      defaultConfidentiality: data.defaultConfidentiality,
      defaultValidityMonths: data.defaultValidityMonths ?? null,
      requiresApproval: data.requiresApproval,
      requiresAcknowledgment: data.requiresAcknowledgment,
      isActive: data.isActive,
      updatedAt: now,
    },
  })
  const [row] = await db.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.id, id))
  return row
}

/* ── Creación de documento (sin archivo todavía) ─────────────────────────── */

export interface CreateDocumentInput {
  data: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}

export async function createDocument({ data, ctx, scope, permissions }: CreateDocumentInput) {
  const parsed = sstDocumentCreateSchema.parse(data)
  assertScopeAccess(parsed.worksiteId || null, scope)
  assertConfidentialityAllowed(parsed.confidentiality, permissions)

  const now = new Date().toISOString()
  const id = `sdoc-${nanoid()}`

  await db.insert(sstDocuments).values({
    id,
    categorySlug: parsed.categorySlug,
    typeId: parsed.typeId || null,
    internalCode: parsed.internalCode || null,
    title: parsed.title,
    description: parsed.description || null,
    worksiteId: parsed.worksiteId || null,
    status: "borrador",
    confidentiality: parsed.confidentiality,
    currentVersionId: null,
    effectiveFrom: parsed.effectiveFrom || null,
    expiresAt: parsed.expiresAt || null,
    responsibleUserId: parsed.responsibleUserId || null,
    uploadedBy: ctx.userId,
    reviewedBy: null,
    approvedBy: null,
    approvedAt: null,
    requiresAcknowledgment: parsed.requiresAcknowledgment ?? false,
    tags: parsed.tags,
    extraMetadata: parsed.extraMetadata,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!row) throw new Error("No se pudo crear el documento.")

  await recordAuditEntry({
    documentId: id,
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    action: "create",
    fromStatus: null,
    toStatus: "borrador",
    ip: ctx.ip,
    metadata: { categorySlug: parsed.categorySlug, confidentiality: parsed.confidentiality },
  })

  // También registramos en la bitácora global para que aparezca en reportes
  // ejecutivos que no consultan la tabla del módulo.
  await recordAudit(
    {
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action: "create",
      entityType: "sst_document",
      entityId: id,
      entityCode: parsed.internalCode || parsed.title.slice(0, 40),
      newState: { categorySlug: parsed.categorySlug, status: "borrador", confidentiality: parsed.confidentiality },
    },
  )

  return row
}

/* ── Actualización de metadata (campos no archivados) ────────────────────── */

export async function updateDocumentMetadata(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const data = sstDocumentUpdateSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.id))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)

  if (doc.status === "archivado") {
    throw new Error("No se puede modificar un documento archivado.")
  }

  if (data.worksiteId !== undefined) {
    assertScopeAccess(data.worksiteId || null, args.scope)
  }

  if (data.confidentiality !== undefined) {
    assertConfidentialityAllowed(data.confidentiality, args.permissions)
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }
  if (data.title !== undefined) patch.title = data.title
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
    documentId: data.id,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "edit",
    ip: args.ctx.ip,
    metadata: { changed: Object.keys(patch).filter((k) => k !== "updatedAt") },
  })

  return updated
}

/* ── Subida de archivo (crea una nueva versión) ─────────────────────────── */

export async function uploadDocumentVersion(args: {
  input: UploadInput
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const data = sstDocumentVersionCreateSchema.parse({
    documentId: args.input.documentId,
    effectiveFrom: args.input.effectiveFrom,
    effectiveTo: args.input.effectiveTo,
    changelog: args.input.changelog,
    supersedesId: args.input.supersedesId,
  })

  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  assertConfidentialityAllowed(doc.confidentiality as SstDocumentConfidentiality, args.permissions)

  if (doc.status === "archivado") {
    throw new Error("No se puede subir versiones a un documento archivado.")
  }

  // Validar archivo (magic bytes + tamaño).
  const file = await readFileToBuffer(args.input.file)
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`)
  }
  if (file.size < 4) {
    throw new Error("El archivo está vacío o es demasiado pequeño.")
  }
  const validated = validateFileBuffer(file.buffer, file.size, ALLOWED_MIMES)
  if (validated.error) throw new Error(validated.error)

  const checksum = sha256Hex(file.buffer)

  // Detección de duplicado: misma checksum + mismo documento.
  const [dupe] = await db
    .select({ id: sstDocumentVersions.id, version: sstDocumentVersions.version })
    .from(sstDocumentVersions)
    .where(and(eq(sstDocumentVersions.documentId, data.documentId), eq(sstDocumentVersions.checksum, checksum)))
    .limit(1)
  if (dupe) {
    throw new Error(`Este archivo ya existe como versión ${dupe.version} del documento.`)
  }

  // Calcular nueva versión con SQL atómico para evitar carreras.
  const storageName = generateStorageName(file.name)
  const relativePath = await persistFileOnDisk(storageName, file.buffer)

  const now = new Date().toISOString()
  const id = `sdv-${nanoid()}`

  const [row] = await db.insert(sstDocumentVersions).values({
    id,
    documentId: data.documentId,
    version: sql`(SELECT COALESCE(MAX(${sstDocumentVersions.version}), 0) + 1 FROM ${sstDocumentVersions} WHERE ${sstDocumentVersions.documentId} = ${data.documentId})`,
    status: "borrador",
    fileName: file.name,
    storageName,
    filePath: relativePath,
    mimeType: validated.mimeType,
    fileSize: file.size,
    checksum,
    effectiveFrom: data.effectiveFrom || null,
    effectiveTo: data.effectiveTo || null,
    changelog: data.changelog || null,
    uploadedBy: args.ctx.userId,
    reviewedBy: null,
    approvedBy: null,
    approvedAt: null,
    supersedesId: data.supersedesId || null,
    createdAt: now,
    updatedAt: now,
  }).returning()

  if (!row) {
    // Rollback: borrar el archivo del disco si falló la inserción en BD.
    try {
      const abs = resolveSstDocumentFile(relativePath)
      if (abs) await fs.unlink(abs)
    } catch (err) {
      logger.warn("[documents-library] no se pudo limpiar archivo huérfano", err)
    }
    throw new Error("No se pudo registrar la nueva versión.")
  }

  // Actualizar checksum en cabecera.
  await db.update(sstDocuments).set({ checksum, updatedAt: now }).where(eq(sstDocuments.id, data.documentId))

  await recordAuditEntry({
    documentId: data.documentId,
    versionId: id,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "upload",
    ip: args.ctx.ip,
    comment: data.changelog || null,
    metadata: { fileName: file.name, size: file.size, mime: validated.mimeType, version: row.version },
  })

  return row
}

/* ── Cambios de estado del documento y de la versión ────────────────────── */

const ALLOWED_DOC_STATUS: Record<SstDocumentStatus, SstDocumentStatus[]> = {
  borrador:    ["en_revision", "archivado"],
  en_revision: ["aprobado", "observado", "borrador", "archivado"],
  observado:   ["en_revision", "borrador", "archivado"],
  aprobado:    ["vigente", "archivado"],
  vigente:     ["vencido", "reemplazado", "archivado"],
  vencido:     ["vigente", "reemplazado", "archivado"],
  reemplazado: ["archivado"],
  archivado:   [],
}

const ALLOWED_VERSION_STATUS: Record<string, SstDocumentStatus[]> = {
  borrador:    ["en_revision", "archivado"],
  en_revision: ["aprobado", "observado", "borrador", "archivado"],
  observado:   ["en_revision", "borrador", "archivado"],
  aprobado:    ["vigente", "archivado"],
  vigente:     ["reemplazado", "archivado"],
  reemplazado: ["archivado"],
  archivado:   [],
}

export async function changeDocumentStatus(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const data = sstDocumentStatusChangeSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const from = doc.status as SstDocumentStatus
  const to = data.toStatus

  if (!ALLOWED_DOC_STATUS[from]?.includes(to)) {
    throw new Error(`Transición inválida: ${from} → ${to}.`)
  }

  // Si pasa a 'aprobado' exige que la versión vigente exista.
  if (to === "aprobado" || to === "vigente") {
    if (!doc.currentVersionId) {
      throw new Error("No se puede aprobar/vigentar un documento sin versión aprobada.")
    }
    const [ver] = await db
      .select({ status: sstDocumentVersions.status })
      .from(sstDocumentVersions)
      .where(eq(sstDocumentVersions.id, doc.currentVersionId))
      .limit(1)
    if (!ver) throw new Error("La versión vigente no existe.")
    if (to === "aprobado" && !["aprobado", "vigente"].includes(ver.status)) {
      throw new Error("La versión actual debe estar aprobada antes que el documento.")
    }
    if (to === "vigente" && ver.status !== "aprobado") {
      throw new Error("La versión actual debe estar aprobada para marcar el documento como vigente.")
    }
  }

  const now = new Date().toISOString()
  const [updated] = await db
    .update(sstDocuments)
    .set({ status: to, updatedAt: now })
    .where(eq(sstDocuments.id, data.documentId))
    .returning()

  if (!updated) throw new Error("No se pudo actualizar el estado del documento.")

  await recordStatusChange({
    entityType: "sst_document",
    entityId: data.documentId,
    fromStatus: from,
    toStatus: to,
    changedBy: args.ctx.userId,
    reason: data.comment,
  })
  await recordAuditEntry({
    documentId: data.documentId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "status_change",
    fromStatus: from,
    toStatus: to,
    comment: data.comment || null,
    ip: args.ctx.ip,
  })

  return updated
}

export async function changeVersionStatus(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentVersionStatusChangeSchema.parse(args.input)
  const [ver] = await db
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, data.versionId))
    .limit(1)
  if (!ver) throw new Error("Versión no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, ver.documentId)).limit(1)
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const from = ver.status as SstDocumentStatus
  const to = data.toStatus as SstDocumentStatus
  if (!ALLOWED_VERSION_STATUS[from]?.includes(to)) {
    throw new Error(`Transición inválida: ${from} → ${to}.`)
  }

  const now = new Date().toISOString()
  const [updated] = await db
    .update(sstDocumentVersions)
    .set({ status: to, updatedAt: now, approvedBy: to === "aprobado" || to === "vigente" ? args.ctx.userId : ver.approvedBy, approvedAt: to === "aprobado" || to === "vigente" ? now : ver.approvedAt })
    .where(eq(sstDocumentVersions.id, data.versionId))
    .returning()

  if (!updated) throw new Error("No se pudo actualizar la versión.")

  // Si pasa a 'vigente' se vuelve la versión actual del documento.
  if (to === "vigente") {
    await db.update(sstDocuments).set({ currentVersionId: ver.id, updatedAt: now, checksum: ver.checksum }).where(eq(sstDocuments.id, ver.documentId))

    // Reemplaza la versión vigente anterior (si existe y es diferente).
    if (doc.currentVersionId && doc.currentVersionId !== ver.id) {
      await db
        .update(sstDocumentVersions)
        .set({ status: "reemplazado", effectiveTo: now.slice(0, 10), updatedAt: now })
        .where(and(eq(sstDocumentVersions.id, doc.currentVersionId), ne(sstDocumentVersions.id, ver.id)))
    }
  }

  await recordAuditEntry({
    documentId: ver.documentId,
    versionId: ver.id,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "status_change",
    fromStatus: from,
    toStatus: to,
    comment: data.comment || null,
    ip: args.ctx.ip,
  })

  return updated
}

/* ── Aprobación rápida y observación con comentario obligatorio ───────── */

export async function approveCurrentVersion(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentApproveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const targetVersionId = data.versionId || doc.currentVersionId
  if (!targetVersionId) {
    throw new Error("No hay versión para aprobar. Sube un archivo primero.")
  }

  await changeVersionStatus({
    input: { versionId: targetVersionId, toStatus: "aprobado", comment: data.comment },
    ctx: args.ctx,
    scope: args.scope,
  })
  await changeVersionStatus({
    input: { versionId: targetVersionId, toStatus: "vigente", comment: data.comment },
    ctx: args.ctx,
    scope: args.scope,
  })

  // Documento pasa a 'vigente' si estaba en revisión/observado/aprobado.
  if (doc.status === "en_revision" || doc.status === "observado" || doc.status === "borrador" || doc.status === "aprobado") {
    await changeDocumentStatus({
      input: { documentId: data.documentId, toStatus: "vigente", comment: data.comment || "Aprobado y vigente" },
      ctx: args.ctx,
      scope: args.scope,
      permissions: [],
    })
  }

  await recordAuditEntry({
    documentId: data.documentId,
    versionId: targetVersionId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "approve",
    comment: data.comment || null,
    ip: args.ctx.ip,
  })

  const [updated] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  return updated
}

export async function observeDocument(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentObserveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const targetVersionId = data.versionId || doc.currentVersionId

  if (targetVersionId) {
    await changeVersionStatus({
      input: { versionId: targetVersionId, toStatus: "observado", comment: data.comment },
      ctx: args.ctx,
      scope: args.scope,
    })
  }

  const from = doc.status as SstDocumentStatus
  if (from !== "observado") {
    await changeDocumentStatus({
      input: { documentId: data.documentId, toStatus: "observado", comment: data.comment },
      ctx: args.ctx,
      scope: args.scope,
      permissions: [],
    })
  }

  await recordAuditEntry({
    documentId: data.documentId,
    versionId: targetVersionId || null,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "observe",
    comment: data.comment,
    ip: args.ctx.ip,
  })

  return { observed: true }
}

/* ── Archivado lógico ───────────────────────────────────────────────────── */

export async function archiveDocument(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentArchiveSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  const now = new Date().toISOString()
  const [updated] = await db
    .update(sstDocuments)
    .set({ status: "archivado", updatedAt: now })
    .where(eq(sstDocuments.id, data.documentId))
    .returning()
  if (!updated) throw new Error("No se pudo archivar el documento.")

  // También archiva las versiones pendientes/borrador.
  await db
    .update(sstDocumentVersions)
    .set({ status: "archivado", updatedAt: now })
    .where(and(eq(sstDocumentVersions.documentId, data.documentId), ne(sstDocumentVersions.status, "vigente"), ne(sstDocumentVersions.status, "aprobado")))

  await recordAuditEntry({
    documentId: data.documentId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "archive",
    comment: data.comment || null,
    ip: args.ctx.ip,
  })

  return updated
}

/* ── Asociación con entidades internas ──────────────────────────────────── */

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
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentLinkSchema.parse(args.input)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  await assertLinkedEntityAccess(data.entityType, data.entityId, args.scope)

  const now = new Date().toISOString()
  const id = `sdlink-${nanoid()}`
  await db.insert(sstDocumentLinks).values({
    id,
    documentId: data.documentId,
    entityType: data.entityType,
    entityId: data.entityId,
    notes: data.notes || null,
    createdAt: now,
  }).onConflictDoNothing()

  await recordAuditEntry({
    documentId: data.documentId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "link",
    ip: args.ctx.ip,
    metadata: { entityType: data.entityType, entityId: data.entityId },
  })

  return { id }
}

export async function unlinkDocumentEntity(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentUnlinkSchema.parse(args.input)
  const [link] = await db.select().from(sstDocumentLinks).where(eq(sstDocumentLinks.id, data.linkId))
  if (!link) throw new Error("Asociación no encontrada.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, link.documentId))
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)

  await db.delete(sstDocumentLinks).where(eq(sstDocumentLinks.id, data.linkId))

  await recordAuditEntry({
    documentId: link.documentId,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "unlink",
    ip: args.ctx.ip,
    metadata: { entityType: link.entityType, entityId: link.entityId },
  })

  return { ok: true }
}

/* ── Acuse de lectura ───────────────────────────────────────────────────── */

export async function acknowledgeVersion(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
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
    id,
    versionId: data.versionId,
    userId: args.ctx.userId,
    method: "digital",
    signature: data.signature,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    acknowledgedAt: now,
  }).onConflictDoUpdate({
    target: [sstDocumentAcknowledgments.versionId, sstDocumentAcknowledgments.userId],
    set: { signature: data.signature, ip: args.ctx.ip ?? null, userAgent: args.ctx.userAgent ?? null, acknowledgedAt: now },
  })

  await recordAuditEntry({
    documentId: ver.documentId,
    versionId: ver.id,
    userId: args.ctx.userId,
    userEmail: args.ctx.userEmail,
    action: "ack",
    ip: args.ctx.ip,
  })

  return { ok: true }
}

/* ── Lectura: documento, versiones, links, acuses, auditoría ──────────── */

export async function getDocumentById(id: string) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  return doc
}

export async function getDocumentBundle(id: string, scope: WorksiteScope) {
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!doc) return null
  assertScopeAccess(doc.worksiteId, scope)

  const versions = await db
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.documentId, id))
    .orderBy(desc(sstDocumentVersions.version))

  const links = await db
    .select()
    .from(sstDocumentLinks)
    .where(eq(sstDocumentLinks.documentId, id))

  const acks = versions.length === 0
    ? []
    : await db
        .select({
          id: sstDocumentAcknowledgments.id,
          versionId: sstDocumentAcknowledgments.versionId,
          userId: sstDocumentAcknowledgments.userId,
          method: sstDocumentAcknowledgments.method,
          signature: sstDocumentAcknowledgments.signature,
          ip: sstDocumentAcknowledgments.ip,
          acknowledgedAt: sstDocumentAcknowledgments.acknowledgedAt,
        })
        .from(sstDocumentAcknowledgments)
        .where(inArray(sstDocumentAcknowledgments.versionId, versions.map((v) => v.id)))

  const audit = await db
    .select()
    .from(sstDocumentAudit)
    .where(eq(sstDocumentAudit.documentId, id))
    .orderBy(desc(sstDocumentAudit.createdAt))
    .limit(200)

  // Calcular el status efectivo (vencido por fecha).
  const effective = { ...doc, status: effectiveStatus(doc.status as SstDocumentStatus, doc.expiresAt) }
  return { doc: effective, versions, links, acks, audit }
}

export async function getVersionById(id: string) {
  const [ver] = await db.select().from(sstDocumentVersions).where(eq(sstDocumentVersions.id, id))
  return ver
}

/* ── Búsqueda + filtros para la biblioteca ──────────────────────────────── */

export async function searchDocuments(input: SstDocumentSearchInput, scope: WorksiteScope) {
  const data = sstDocumentSearchSchema.parse(input)
  const conditions: (SQL | undefined)[] = []

  if (data.q) {
    const q = `%${data.q.replace(/[%_]/g, (m) => `\\${m}`)}%`
    conditions.push(or(
      like(sstDocuments.title, q),
      like(sstDocuments.internalCode, q),
      like(sstDocuments.description, q),
    ))
  }
  if (data.categorySlug) conditions.push(eq(sstDocuments.categorySlug, data.categorySlug))
  if (data.status) conditions.push(eq(sstDocuments.status, data.status))
  if (data.confidentiality) conditions.push(eq(sstDocuments.confidentiality, data.confidentiality))
  if (data.worksiteId) conditions.push(eq(sstDocuments.worksiteId, data.worksiteId))
  if (data.responsibleUserId) conditions.push(eq(sstDocuments.responsibleUserId, data.responsibleUserId))
  if (data.expiresBefore) conditions.push(lte(sstDocuments.expiresAt, data.expiresBefore))
  if (data.expiresAfter) conditions.push(sql`${sstDocuments.expiresAt} IS NOT NULL`)

  // Filtro por entidad (vía join con sstDocumentLinks).
  if (data.entityType && data.entityId) {
    const docIds = await db
      .select({ documentId: sstDocumentLinks.documentId })
      .from(sstDocumentLinks)
      .where(and(eq(sstDocumentLinks.entityType, data.entityType), eq(sstDocumentLinks.entityId, data.entityId)))
    if (docIds.length === 0) {
      return { rows: [], total: 0 }
    }
    conditions.push(inArray(sstDocuments.id, docIds.map((d) => d.documentId)))
  } else if (data.entityType) {
    const docIds = await db
      .select({ documentId: sstDocumentLinks.documentId })
      .from(sstDocumentLinks)
      .where(eq(sstDocumentLinks.entityType, data.entityType))
    if (docIds.length === 0) {
      return { rows: [], total: 0 }
    }
    conditions.push(inArray(sstDocuments.id, docIds.map((d) => d.documentId)))
  }

  if (scope.mode === "some") {
    conditions.push(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId)))
  }
  // Para mode === "all" o "none" dejamos el filtro abierto: global ve todo,
  // "none" no debería llegar aquí (middleware corta antes).

  const where = conditions.length ? and(...conditions) : undefined
  const offset = (data.page - 1) * data.pageSize

  const [rows, totalRow] = await Promise.all([
    db.select().from(sstDocuments).where(where).orderBy(desc(sstDocuments.updatedAt)).limit(data.pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(sstDocuments).where(where),
  ])

  // Re-calcular estado efectivo (vencido por fecha).
  const effectiveRows = rows.map((r) => ({ ...r, status: effectiveStatus(r.status as SstDocumentStatus, r.expiresAt) }))
  return { rows: effectiveRows, total: Number(totalRow[0]?.count ?? 0) }
}

/* ── Dashboard documental ───────────────────────────────────────────────── */

export interface DashboardCounters {
  total: number
  byStatus: Record<SstDocumentStatus, number>
  expiringSoon: { within7: number; within15: number; within30: number }
  pendingReview: number
  observed: number
  ackPending: number
}

export async function getDashboardCounters(scope: WorksiteScope): Promise<DashboardCounters> {
  const baseWhere = scope.mode === "some"
    ? or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))
    : undefined

  const all = await db
    .select({ id: sstDocuments.id, status: sstDocuments.status, expiresAt: sstDocuments.expiresAt, currentVersionId: sstDocuments.currentVersionId, requiresAcknowledgment: sstDocuments.requiresAcknowledgment })
    .from(sstDocuments)
    .where(baseWhere)

  const byStatus: Record<SstDocumentStatus, number> = {
    borrador: 0, en_revision: 0, observado: 0, aprobado: 0,
    vigente: 0, vencido: 0, reemplazado: 0, archivado: 0,
  }
  let expiring7 = 0
  let expiring15 = 0
  let expiring30 = 0
  let ackPending = 0

  for (const d of all) {
    const eff = effectiveStatus(d.status as SstDocumentStatus, d.expiresAt)
    byStatus[eff] = (byStatus[eff] ?? 0) + 1
    const days = daysUntil(d.expiresAt)
    if (days !== null && eff === "vigente") {
      if (days <= 7) expiring7 += 1
      else if (days <= 15) expiring15 += 1
      else if (days <= 30) expiring30 += 1
    }
    if (d.requiresAcknowledgment && d.currentVersionId && (eff === "vigente" || eff === "vencido")) {
      ackPending += 1 // conteo aproximado, el refinado se hace en getExpiringDocuments
    }
  }

  return {
    total: all.length,
    byStatus,
    expiringSoon: { within7: expiring7, within15: expiring15, within30: expiring30 },
    pendingReview: byStatus.en_revision,
    observed: byStatus.observado,
    ackPending,
  }
}

export interface ExpiringDocument {
  id: string
  title: string
  internalCode: string | null
  status: SstDocumentStatus
  expiresAt: string | null
  daysRemaining: number | null
  worksiteId: string | null
  categorySlug: string
  responsibleUserId: string | null
}

export async function getExpiringDocuments(scope: WorksiteScope, daysAhead = 30, limit = 200): Promise<ExpiringDocument[]> {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const whereParts = [
    isNotNull(sstDocuments.expiresAt),
    lte(sstDocuments.expiresAt, target),
    ne(sstDocuments.status, "archivado"),
    ne(sstDocuments.status, "reemplazado"),
  ]
  if (scope.mode === "some") {
    const scopedWorksite = or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))
    if (scopedWorksite) whereParts.push(scopedWorksite)
  }

  const rows = await db
    .select({
      id: sstDocuments.id,
      title: sstDocuments.title,
      internalCode: sstDocuments.internalCode,
      status: sstDocuments.status,
      expiresAt: sstDocuments.expiresAt,
      worksiteId: sstDocuments.worksiteId,
      categorySlug: sstDocuments.categorySlug,
      responsibleUserId: sstDocuments.responsibleUserId,
    })
    .from(sstDocuments)
    .where(and(...whereParts))
    .orderBy(sstDocuments.expiresAt)
    .limit(limit)

  return rows.map((r) => ({
    ...r,
    status: effectiveStatus(r.status as SstDocumentStatus, r.expiresAt),
    daysRemaining: daysUntil(r.expiresAt),
  }))
}

/* ── Bandeja de revisión (documentos pendientes) ─────────────────────────── */

export async function listReviewQueue(scope: WorksiteScope) {
  const whereParts = [
    or(eq(sstDocuments.status, "en_revision"), eq(sstDocuments.status, "observado")),
  ]
  if (scope.mode === "some") whereParts.push(or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId)))
  return db
    .select()
    .from(sstDocuments)
    .where(and(...whereParts))
    .orderBy(desc(sstDocuments.updatedAt))
    .limit(100)
}

/* ── Export XLSX (lib/reports/export.ts provee buildXlsxBuffer) ─────────── */

export interface DocumentExportRow {
  categoria: string
  tipo: string
  codigo: string
  titulo: string
  estado: string
  confidencialidad: string
  faena: string | null
  responsable: string | null
  subidoPor: string | null
  aprobadoPor: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  diasParaVencer: number | null
  versionVigente: number | null
  requiereAcuse: string
  actualizado: string
}

export async function buildDocumentsExport(scope: WorksiteScope, filters: Partial<SstDocumentSearchInput> = {}) {
  const { rows } = await searchDocuments({ ...filters, page: filters.page ?? 1, pageSize: filters.pageSize ?? 10_000 } as SstDocumentSearchInput, scope)

  // Hidratar nombres referenciados.
  const userIds = new Set<string>()
  const worksiteIds = new Set<string>()
  for (const r of rows) {
    if (r.responsibleUserId) userIds.add(r.responsibleUserId)
    if (r.uploadedBy) userIds.add(r.uploadedBy)
    if (r.approvedBy) userIds.add(r.approvedBy)
    if (r.worksiteId) worksiteIds.add(r.worksiteId)
  }
  const userRows = userIds.size ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, Array.from(userIds))) : []
  const userName = (id: string | null) => (id ? userRows.find((u) => u.id === id)?.name ?? id : null)
  const worksiteRows = worksiteIds.size ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, Array.from(worksiteIds))) : []
  const worksiteName = (id: string | null) => (id ? worksiteRows.find((w) => w.id === id)?.name ?? id : null)

  // Categorías y tipos.
  const categories = await db.select().from(sstDocumentCategories)
  const types = await db.select().from(sstDocumentTypes)
  const catName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug
  const typeName = (id: string | null) => id ? types.find((t) => t.id === id)?.name ?? id : ""

  const exportRows: DocumentExportRow[] = rows.map((d) => ({
    categoria: catName(d.categorySlug),
    tipo: typeName(d.typeId),
    codigo: d.internalCode ?? "",
    titulo: d.title,
    estado: d.status as string,
    confidencialidad: d.confidentiality as string,
    faena: worksiteName(d.worksiteId),
    responsable: userName(d.responsibleUserId),
    subidoPor: userName(d.uploadedBy),
    aprobadoPor: userName(d.approvedBy),
    fechaEmision: d.effectiveFrom ?? "",
    fechaVencimiento: d.expiresAt ?? "",
    diasParaVencer: d.expiresAt ? daysUntil(d.expiresAt) : null,
    versionVigente: null, // se hidrata abajo si es necesario
    requiereAcuse: d.requiresAcknowledgment ? "Sí" : "No",
    actualizado: d.updatedAt.slice(0, 10),
  }))

  return {
    filenameBase: "biblioteca-sst",
    worksheetName: "Biblioteca SST",
    headers: [
      "Categoría", "Tipo", "Código", "Título", "Estado", "Confidencialidad",
      "Faena", "Responsable", "Subido por", "Aprobado por", "Fecha emisión",
      "Vencimiento", "Días para vencer", "Versión vigente", "Requiere acuse", "Actualizado",
    ],
    rows: exportRows.map((r) => [
      r.categoria, r.tipo, r.codigo, r.titulo, r.estado, r.confidencialidad,
      r.faena, r.responsable, r.subidoPor, r.aprobadoPor, r.fechaEmision,
      r.fechaVencimiento, r.diasParaVencer, r.versionVigente, r.requiereAcuse, r.actualizado,
    ]),
  }
}

/* ── Seed helper (categorías por defecto) ──────────────────────────────── */

export const DEFAULT_CATEGORIES: Array<{ slug: string; name: string; description: string; sortOrder: number }> = [
  { slug: "gestion_preventiva", name: "Gestión preventiva", description: "Política, MIPER, mapas de riesgo, procedimientos, auditorías internas.", sortOrder: 10 },
  { slug: "legal_normativa", name: "Legal y normativa", description: "RIOHS, protocolos obligatorios, fiscalización, evidencias regulatorias.", sortOrder: 20 },
  { slug: "capacitacion", name: "Capacitación e inducciones", description: "Asistencia, materiales, certificados, inducciones, ODI.", sortOrder: 30 },
  { slug: "epp", name: "EPP", description: "Actas de entrega, reposición, fichas técnicas, certificaciones.", sortOrder: 40 },
  { slug: "incidentes", name: "Incidentes y accidentes", description: "Investigaciones, reportes, evidencias, medidas correctivas.", sortOrder: 50 },
  { slug: "comite", name: "Comité Paritario", description: "Constitución, actas, acuerdos, programas de trabajo.", sortOrder: 60 },
  { slug: "emergencias", name: "Emergencias", description: "Planes, planos, simulacros, brigadas, equipos de emergencia.", sortOrder: 70 },
  { slug: "equipos_vehiculos", name: "Equipos, vehículos y maquinaria", description: "Hojas SDS, fichas técnicas, mantenciones, certificaciones.", sortOrder: 80 },
  { slug: "fiscalizacion", name: "Fiscalización y auditorías", description: "Actas, observaciones, respuestas, planes de regularización.", sortOrder: 90 },
  { slug: "salud_ocupacional", name: "Salud ocupacional", description: "Protocolos MINSAL, aptitudes, restricciones.", sortOrder: 100 },
]

/**
 * Idempotente: crea las categorías por defecto si no existen. Se invoca
 * desde el seed general para garantizar la taxonomía mínima.
 */
export async function seedDefaultCategories() {
  const now = new Date().toISOString()
  for (const c of DEFAULT_CATEGORIES) {
    await db.insert(sstDocumentCategories).values({
      slug: c.slug,
      name: c.name,
      description: c.description,
      sortOrder: c.sortOrder,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: sstDocumentCategories.slug,
      set: { name: c.name, description: c.description, sortOrder: c.sortOrder, isActive: true, updatedAt: now },
    })
  }
}

export { todayIso }

/* ── API helpers: registro de visualizaciones y descargas ──────────────── */

export async function recordDocumentView(args: {
  documentId: string
  versionId?: string | null
  userId: string
  source?: string
  ip?: string | null
}) {
  await recordAuditEntry({
    documentId: args.documentId,
    versionId: args.versionId ?? null,
    userId: args.userId,
    action: "view",
    metadata: { source: args.source ?? "api" },
    ip: args.ip ?? null,
  })
}

export async function recordDocumentDownload(args: {
  documentId: string
  versionId?: string | null
  userId: string
  source?: string
  ip?: string | null
}) {
  await recordAuditEntry({
    documentId: args.documentId,
    versionId: args.versionId ?? null,
    userId: args.userId,
    action: "download",
    metadata: { source: args.source ?? "api" },
    ip: args.ip ?? null,
  })
}
