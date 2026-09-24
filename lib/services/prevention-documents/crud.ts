import { and, eq, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  sstDocumentFolders,
  sstDocuments,
  sstDocumentTypes,
  sstDocumentVersions,
} from "@/db/schema"
import { assessRiohsCompleteness, RIOHS_DOCUMENT_TYPE_CODE, type RiohsMetadata } from "@/lib/prevention/riohs"
import { onLegalFolderDocumentChanged } from "@/lib/services/pdtp-adapters/legal-folder-connector"
import {
  dispatchDocumentVersionCurrentEffects,
  makeDocumentVersionCurrent,
  type DocumentVersionCurrentEffects,
} from "./publication"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { deleteSstDocument } from "@/lib/storage/sst-backend"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { getFolderRemoteSegments } from "./folder-storage"
import { relocateDocumentFiles } from "./folders-move"
import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentVersionCreateSchema,
  sstDocumentArchiveSchema,
} from "@/lib/validation/prevention"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  type SstDocumentConfidentiality,
  type RequestContext,
  type CreateDocumentInput,
  type UploadInput,
  assertScopeAccess,
  assertConfidentialityAllowed,
  assertGeneralLibraryContentAllowed,
  readFileToBuffer,
  persistFileOnDisk,
  generateStorageName,
  sha256Hex,
  recordAuditEntry,
  todayIso,
} from "./utils"

const ALLOWED_MIMES = MimeType.DOCUMENT_LIBRARY
const MAX_FILE_SIZE = 25 * 1024 * 1024

/* ── Creación de documento ──────────────────────────────────────────────── */

export async function createDocument({ data, ctx, scope, permissions }: CreateDocumentInput) {
  const parsed = sstDocumentCreateSchema.parse(data)
  // Un documento creado dentro de la carpeta de una faena es de esa faena: la
  // carpeta ya la declara (las subcarpetas la heredan en `folders-crud.ts`) y
  // sin esto la carga masiva dejaba "corporativo" todo lo que se soltaba en la
  // carpeta de una faena. Declarar otra faena que la de la carpeta es un error.
  if (parsed.folderId) {
    const [folder] = await db.select({ worksiteId: sstDocumentFolders.worksiteId })
      .from(sstDocumentFolders).where(eq(sstDocumentFolders.id, parsed.folderId)).limit(1)
    if (!folder) throw new Error("Carpeta no encontrada.")
    if (folder.worksiteId) {
      if (parsed.worksiteId && parsed.worksiteId !== folder.worksiteId) {
        throw new Error("La carpeta pertenece a otra faena que la declarada para el documento.")
      }
      parsed.worksiteId = folder.worksiteId
    }
  }
  if (parsed.typeId) {
    // La categoría la define el tipo: dos fuentes para lo mismo divergían.
    const [type] = await db.select({ categorySlug: sstDocumentTypes.categorySlug, isActive: sstDocumentTypes.isActive })
      .from(sstDocumentTypes).where(eq(sstDocumentTypes.id, parsed.typeId)).limit(1)
    if (!type || !type.isActive) throw new Error("El tipo documental seleccionado no existe o está inactivo.")
    parsed.categorySlug = type.categorySlug
  }
  assertScopeAccess(parsed.worksiteId || null, scope)
  assertConfidentialityAllowed(parsed.confidentiality, permissions)
  assertGeneralLibraryContentAllowed({ dataClass: parsed.dataClass, title: parsed.title })

  const now = new Date().toISOString()
  const id = `sdoc-${nanoid()}`

  await db.insert(sstDocuments).values({
    id, categorySlug: parsed.categorySlug, typeId: parsed.typeId || null,
    folderId: parsed.folderId || null,
    internalCode: parsed.internalCode || null, title: parsed.title,
    description: parsed.description || null, worksiteId: parsed.worksiteId || null,
    status: "borrador", confidentiality: parsed.confidentiality,
    dataClass: parsed.dataClass,
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
  if (data.dataClass !== undefined) {
    assertGeneralLibraryContentAllowed({ dataClass: data.dataClass, title: data.title ?? doc.title })
  }

  const now = new Date().toISOString()
  // Cambio de carpeta: mover primero los archivos físicos de todas las
  // versiones (con compensación si falla), y solo después persistir el
  // folderId nuevo — la BD sigue siendo la fuente de verdad.
  if (data.folderId !== undefined) {
    const targetFolderId = data.folderId || null
    if (targetFolderId !== doc.folderId) {
      const fromSegments = await getFolderRemoteSegments(doc.folderId)
      const toSegments = await getFolderRemoteSegments(targetFolderId)
      await relocateDocumentFiles(doc.id, fromSegments, toSegments)
    }
  }

  const patch: Record<string, unknown> = { updatedAt: now }
  if (data.typeId !== undefined && (data.typeId || null) !== doc.typeId) {
    if (data.typeId) {
      const [type] = await db.select({
        categorySlug: sstDocumentTypes.categorySlug,
        code: sstDocumentTypes.code,
        isActive: sstDocumentTypes.isActive,
        requiresAcknowledgment: sstDocumentTypes.requiresAcknowledgment,
      }).from(sstDocumentTypes).where(eq(sstDocumentTypes.id, data.typeId)).limit(1)
      if (!type || !type.isActive) throw new Error("El tipo documental seleccionado no existe o está inactivo.")
      // Clasificar como RIOHS un documento ya vigente lo haría pasar por
      // vigente sin la verificación del DS 44 art. 58 que exige publicarlo.
      if (type.code === RIOHS_DOCUMENT_TYPE_CODE && doc.status === "vigente") {
        const metadata = ((data.extraMetadata ?? doc.extraMetadata) ?? {}) as RiohsMetadata
        const completeness = assessRiohsCompleteness(metadata.riohsSections)
        if (!completeness.complete) {
          throw new Error("Un documento vigente sólo puede clasificarse como Reglamento Interno si declara el contenido mínimo del DS 44 art. 58.")
        }
      }
      patch.typeId = data.typeId
      patch.categorySlug = type.categorySlug
      if (type.requiresAcknowledgment && !doc.requiresAcknowledgment && data.requiresAcknowledgment === undefined) {
        patch.requiresAcknowledgment = true
      }
    } else {
      patch.typeId = null
    }
  }
  if (data.title !== undefined) patch.title = data.title
  if (data.folderId !== undefined) patch.folderId = data.folderId || null
  if (data.description !== undefined) patch.description = data.description || null
  if (data.worksiteId !== undefined) patch.worksiteId = data.worksiteId || null
  if (data.confidentiality !== undefined) patch.confidentiality = data.confidentiality
  if (data.dataClass !== undefined) patch.dataClass = data.dataClass
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
  // Clasificar, mover de faena o cambiar el vencimiento de un documento
  // vigente puede completar la carpeta de requisitos legales (N°19) de la
  // faena de antes o de la de ahora.
  if (updated.status === "vigente"
    && (updated.typeId !== doc.typeId || updated.worksiteId !== doc.worksiteId || updated.expiresAt !== doc.expiresAt)) {
    await onLegalFolderDocumentChanged({
      typeIds: [doc.typeId, updated.typeId],
      worksiteIds: [doc.worksiteId, updated.worksiteId],
    })
  }
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
  assertGeneralLibraryContentAllowed({ dataClass: doc.dataClass, title: doc.title, fileName: args.input.file.name })
  if (data.effectiveFrom && data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    throw new Error("La vigencia no puede terminar antes de comenzar.")
  }

  const file = await readFileToBuffer(args.input.file)
  if (file.size > MAX_FILE_SIZE) throw new Error(`El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`)
  if (file.size < 4) throw new Error("El archivo está vacío o es demasiado pequeño.")
  const validated = validateFileBuffer(file.buffer, file.size, ALLOWED_MIMES, file.name)
  if (validated.error) throw new Error(validated.error)

  const checksum = sha256Hex(file.buffer)
  const [dupe] = await db
    .select({ id: sstDocumentVersions.id, version: sstDocumentVersions.version })
    .from(sstDocumentVersions)
    .where(and(eq(sstDocumentVersions.documentId, data.documentId), eq(sstDocumentVersions.checksum, checksum)))
    .limit(1)
  if (dupe) throw new Error(`Este archivo ya existe como versión ${dupe.version} del documento.`)

  const storageName = generateStorageName(file.name)
  const folderSegments = await getFolderRemoteSegments(doc.folderId)
  const relativePath = await persistFileOnDisk(storageName, file.buffer, folderSegments)

  let effects: DocumentVersionCurrentEffects | null = null
  let row: typeof sstDocumentVersions.$inferSelect
  try {
    row = await db.transaction(async (tx) => {
      // Bloquear el documento serializa dos cargas simultáneas: con la carga
      // directa, las dos intentarían reemplazar la misma vigente.
      const [locked] = await tx.select().from(sstDocuments).where(eq(sstDocuments.id, doc.id)).for("update")
      if (!locked) throw new Error("Documento no encontrado.")
      if (locked.status === "archivado") throw new Error("No se puede subir versiones a un documento archivado.")

      const now = new Date().toISOString()
      const id = `sdv-${nanoid()}`
      const [inserted] = await tx.insert(sstDocumentVersions).values({
        id, documentId: data.documentId,
        version: sql`(SELECT COALESCE(MAX(${sstDocumentVersions.version}), 0) + 1 FROM ${sstDocumentVersions} WHERE ${sstDocumentVersions.documentId} = ${data.documentId})`,
        status: "borrador", fileName: file.name, storageName, filePath: relativePath,
        mimeType: validated.mimeType, fileSize: file.size, checksum,
        effectiveFrom: data.effectiveFrom || null, effectiveTo: data.effectiveTo || null,
        changelog: data.changelog || null, uploadedBy: args.ctx.userId,
        reviewedBy: null, approvedBy: null, approvedAt: null,
        supersedesId: data.supersedesId || null, createdAt: now, updatedAt: now,
      }).returning()
      if (!inserted) throw new Error("No se pudo registrar la nueva versión.")

      const direct = await resolveDirectPublication(tx, locked, inserted)
      await recordAuditEntry({
        documentId: data.documentId, versionId: id, userId: args.ctx.userId, userEmail: args.ctx.userEmail,
        action: "upload", fromStatus: null, toStatus: "borrador", ip: args.ctx.ip,
        comment: data.changelog || null,
        metadata: {
          fileName: file.name,
          size: file.size,
          mime: validated.mimeType,
          version: inserted.version,
          publication: direct ? "direct_no_approval" : "pending_review",
        },
      }, tx)
      if (!direct) return inserted

      // Registro externo: el tipo no requiere aprobación, así que la versión
      // queda vigente por el mismo paso que una publicación (reemplazo de la
      // anterior, vencimiento, efectos sobre el programa preventivo).
      const current = await makeDocumentVersionCurrent(tx, {
        doc: locked,
        version: inserted,
        ctx: args.ctx,
        comment: data.changelog || undefined,
        fromStatus: "borrador",
        approvalMode: "not_required",
        auditMetadata: { publication: "direct_no_approval" },
        now,
      })
      effects = current.effects
      return current.published
    })
  } catch (error) {
    try { await deleteSstDocument(relativePath) }
    catch (err) { logger.warn("[documents-library] no se pudo limpiar archivo huérfano", err) }
    throw error
  }

  if (effects) await dispatchDocumentVersionCurrentEffects(effects)
  return row
}

/**
 * ¿Esta carga deja la versión vigente de inmediato? Sólo si el documento está
 * clasificado con un tipo que no requiere aprobación, el tipo no es el RIOHS
 * (que tiene contenido mínimo legal y siempre pasa por el ciclo) y la versión
 * ya rige. Un documento sin clasificar sigue el camino de siempre: borrador.
 */
async function resolveDirectPublication(
  tx: Tx,
  doc: typeof sstDocuments.$inferSelect,
  version: typeof sstDocumentVersions.$inferSelect,
): Promise<boolean> {
  if (!doc.typeId) return false
  const [type] = await tx.select({ code: sstDocumentTypes.code, requiresApproval: sstDocumentTypes.requiresApproval, isActive: sstDocumentTypes.isActive })
    .from(sstDocumentTypes).where(eq(sstDocumentTypes.id, doc.typeId)).limit(1)
  if (!type || type.requiresApproval || !type.isActive) return false
  if (type.code === RIOHS_DOCUMENT_TYPE_CODE) return false
  if (version.effectiveFrom && version.effectiveFrom > todayIso()) {
    throw new Error(`Este tipo queda vigente al cargarlo, y su vigencia empieza el ${version.effectiveFrom}. Cárgalo desde esa fecha.`)
  }
  return true
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
  // Documento y versiones en la misma transacción: un fallo entremedio dejaba
  // el documento `archivado` con versiones en `borrador`/`en_revision` activas,
  // y `authorizeWorkflowContext` bloquea operar sobre documento archivado — o
  // sea que esas versiones quedaban congeladas sin transición posible.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(sstDocuments).set({ status: "archivado", updatedAt: now }).where(eq(sstDocuments.id, data.documentId)).returning()
    if (!row) throw new Error("No se pudo archivar el documento.")
    await tx.update(sstDocumentVersions).set({ status: "archivado", updatedAt: now }).where(and(eq(sstDocumentVersions.documentId, data.documentId), ne(sstDocumentVersions.status, "vigente"), ne(sstDocumentVersions.status, "aprobado")))
    await recordAuditEntry({ documentId: data.documentId, userId: args.ctx.userId, userEmail: args.ctx.userEmail, action: "archive", comment: data.comment || null, ip: args.ctx.ip }, tx)
    return row
  })
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
