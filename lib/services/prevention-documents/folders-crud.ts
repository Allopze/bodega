import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments, sstDocumentVersions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  sstDocumentFolderCreateSchema,
  sstDocumentFolderUpdateSchema,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  assertScopeAccess,
  folderSlug,
  normalizeFolderName,
  type RequestContext,
} from "./utils"
import { getFolderRemoteSegments } from "./folder-storage"
import {
  ARCHIVED_PREFIX,
  remoteSegment,
  sstPrefixReplace,
} from "@/lib/services/cloudreve/sst-path"
import { createSstFolder, moveSstFolder } from "@/lib/storage/sst-folders"
import { PreventionDocumentDomainError } from "./errors"

function normalizeNullableId(value: string | null | undefined) {
  return value ? value : null
}

async function getFolderOrThrow(id: string, scope: WorksiteScope) {
  const [folder] = await db.select().from(sstDocumentFolders).where(eq(sstDocumentFolders.id, id)).limit(1)
  if (!folder || folder.archivedAt) throw new PreventionDocumentDomainError("Carpeta no encontrada.")
  assertScopeAccess(folder.worksiteId, scope)
  return folder
}

async function assertParent(parentId: string | null, scope: WorksiteScope) {
  if (!parentId) return null
  return getFolderOrThrow(parentId, scope)
}

/** `storage/sst-documents/<segmentos>` para una carpeta. */
function logicalFolderPath(segments: readonly string[]): string {
  return `storage/sst-documents/${segments.join("/")}`.replace(/\/+$/, "")
}

/**
 * Ruta de archivo de una carpeta en el drive (destino al archivar). Único por
 * id: dos carpetas pueden compartir nombre, y `Archivados/<ruta-relativa>` ya
 * puede existir para otra carpeta archivada. `<id>-<nombre>` mantiene el
 * nombre visible y evita colisiones, sin migrar el modelo de folders.
 */
function archivedFolderSegment(folder: { id: string; name: string }): string {
  return `${ARCHIVED_PREFIX}/${folder.id}-${remoteSegment(folder.name)}`
}

/**
 * Reescribe los file_paths de las versiones bajo un prefijo cuando su carpeta
 * física se movió. La carpeta física ya se movió ANTES de llamar a esto; un
 * fallo dispara el MOVE inverso en el caller.
 */
async function rewriteVersionPaths(
  oldPrefix: string,
  newPrefix: string,
  where: SQL | undefined,
): Promise<void> {
  const rows = await db
    .select({ id: sstDocumentVersions.id, filePath: sstDocumentVersions.filePath })
    .from(sstDocumentVersions)
    .where(where)
  for (const row of rows) {
    const rewritten = sstPrefixReplace(row.filePath, oldPrefix, newPrefix)
    if (!rewritten) continue
    await db.update(sstDocumentVersions)
      .set({ filePath: rewritten, updatedAt: new Date().toISOString() })
      .where(eq(sstDocumentVersions.id, row.id))
  }
}

export async function createDocumentFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentFolderCreateSchema.parse(args.input)
  const parentId = normalizeNullableId(data.parentId)
  const worksiteId = normalizeNullableId(data.worksiteId)
  const parent = await assertParent(parentId, args.scope)
  const effectiveWorksiteId = worksiteId ?? parent?.worksiteId ?? null
  assertScopeAccess(effectiveWorksiteId, args.scope)

  const name = normalizeFolderName(data.name)
  const now = new Date().toISOString()
  const [folder] = await db.insert(sstDocumentFolders).values({
    id: `sdf-${nanoid()}`,
    parentId,
    name,
    slug: folderSlug(name),
    worksiteId: effectiveWorksiteId,
    createdBy: args.ctx.userId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!folder) throw new Error("No se pudo crear la carpeta.")

  // Espeja la carpeta en el storage. Si el backend no responde, la fila se
  // revierte: una carpeta que existe en la plataforma pero no en el drive
  // rompería la paridad que este flujo promete.
  const parentSegments = await getFolderRemoteSegments(parentId)
  const segments = [...parentSegments, remoteSegment(folder.name)]
  try {
    await createSstFolder(logicalFolderPath(segments))
  } catch (error) {
    await db.delete(sstDocumentFolders).where(eq(sstDocumentFolders.id, folder.id))
    logger.error("[documents-library] no se pudo crear la carpeta en el storage; fila revertida", error)
    throw new Error("No se pudo crear la carpeta en el almacenamiento.")
  }
  return folder
}

export async function renameDocumentFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentFolderUpdateSchema.parse(args.input)
  const folder = await getFolderOrThrow(data.id, args.scope)
  const name = normalizeFolderName(data.name)

  const parentSegments = await getFolderRemoteSegments(folder.parentId)
  const oldSegment = remoteSegment(folder.name)
  const newSegment = remoteSegment(name)
  if (oldSegment === newSegment) {
    // Solo cambió el nombre visible en BD (p. ej. mayúsculas/acentos que no
    // alteran el segmento): actualizar la fila sin tocar el storage.
    const [updated] = await db.update(sstDocumentFolders)
      .set({ name, slug: folderSlug(name), updatedAt: new Date().toISOString() })
      .where(eq(sstDocumentFolders.id, data.id))
      .returning()
    if (!updated) throw new Error("No se pudo renombrar la carpeta.")
    return updated
  }

  const oldRel = [...parentSegments, oldSegment].join("/")
  const newRel = [...parentSegments, newSegment].join("/")

  // 1. MOVE físico (colección entera, el contenido viaja con ella).
  try {
    await moveSstFolder(
      `storage/sst-documents/${oldRel}`,
      `storage/sst-documents/${newRel}`,
    )
  } catch (error) {
    logger.error("[documents-library] no se pudo mover la carpeta en el storage", error)
    throw new Error("No se pudo mover la carpeta en el almacenamiento.")
  }

  // 2. Reescribe los paths guardados de las versiones bajo ese prefijo.
  try {
    await rewriteVersionPaths(
      oldRel,
      newRel,
      sql`${sstDocumentVersions.filePath} LIKE ${`storage/sst-documents/${oldRel}/%`}`,
    )
  } catch (_error) {
    // Compensa: devolver la carpeta física a su lugar y abortar.
    await moveSstFolder(
      `storage/sst-documents/${newRel}`,
      `storage/sst-documents/${oldRel}`,
    ).catch((revertError) => {
      logger.error("[documents-library] no se pudo revertir el MOVE tras fallo de BD", revertError)
    })
    throw new Error("No se pudo renombrar la carpeta (los archivos no se actualizaron).")
  }

  const [updated] = await db.update(sstDocumentFolders)
    .set({ name, slug: folderSlug(name), updatedAt: new Date().toISOString() })
    .where(eq(sstDocumentFolders.id, data.id))
    .returning()
  if (!updated) throw new Error("No se pudo renombrar la carpeta.")
  return updated
}

export async function archiveDocumentFolder(args: {
  input: { id: string }
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const folder = await getFolderOrThrow(args.input.id, args.scope)
  // Archivar con contenido activo dejaba subcarpetas y documentos huérfanos e
  // inaccesibles desde el árbol (el breadcrumb lanza si un ancestro está archivado).
  const [[activeChild], [activeDoc]] = await Promise.all([
    db.select({ id: sstDocumentFolders.id }).from(sstDocumentFolders)
      .where(and(eq(sstDocumentFolders.parentId, folder.id), isNull(sstDocumentFolders.archivedAt)))
      .limit(1),
    db.select({ id: sstDocuments.id }).from(sstDocuments)
      .where(and(eq(sstDocuments.folderId, folder.id), ne(sstDocuments.status, "archivado")))
      .limit(1),
  ])
  if (activeChild || activeDoc) {
    throw new PreventionDocumentDomainError("La carpeta tiene subcarpetas o documentos activos. Muévelos o archívalos antes de archivar la carpeta.")
  }

  const parentSegments = await getFolderRemoteSegments(folder.parentId)
  const oldRel = [...parentSegments, remoteSegment(folder.name)].join("/")
  const archivedRel = archivedFolderSegment(folder)

  // 1. MOVE físico de la colección al segmento único de Archivados.
  try {
    await moveSstFolder(
      `storage/sst-documents/${oldRel}`,
      `storage/sst-documents/${archivedRel}`,
    )
  } catch (error) {
    logger.error("[documents-library] no se pudo mover la carpeta a Archivados", error)
    throw new Error("No se pudo mover la carpeta a Archivados en el almacenamiento.")
  }

  // 2. Reescribe los paths guardados (solo los de la colección movida). Las
  // versiones de descendientes ya archivados viven fuera de la colección y
  // conservan sus paths (Archivados/...).
  try {
    await rewriteVersionPaths(
      oldRel,
      archivedRel,
      sql`${sstDocumentVersions.filePath} LIKE ${`storage/sst-documents/${oldRel}/%`}`,
    )
  } catch (_error) {
    await moveSstFolder(
      `storage/sst-documents/${archivedRel}`,
      `storage/sst-documents/${oldRel}`,
    ).catch((revertError) => {
      logger.error("[documents-library] no se pudo revertir el MOVE a Archivados tras fallo de BD", revertError)
    })
    throw new Error("No se pudo archivar la carpeta (los archivos no se actualizaron).")
  }

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocumentFolders)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(sstDocumentFolders.id, folder.id))
    .returning()
  if (!updated) throw new Error("No se pudo archivar la carpeta.")
  return updated
}

export async function restoreDocumentFolder(args: {
  input: { id: string }
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const [folder] = await db.select().from(sstDocumentFolders).where(eq(sstDocumentFolders.id, args.input.id)).limit(1)
  if (!folder || !folder.archivedAt) throw new PreventionDocumentDomainError("Carpeta archivada no encontrada.")
  assertScopeAccess(folder.worksiteId, args.scope)

  // Restaurar bajo un padre aún archivado dejaría la carpeta huérfana (invisible
  // en el árbol y con breadcrumb roto): se re-cuelga en la raíz.
  let parentId = folder.parentId
  if (parentId) {
    const [parent] = await db.select({ archivedAt: sstDocumentFolders.archivedAt })
      .from(sstDocumentFolders).where(eq(sstDocumentFolders.id, parentId)).limit(1)
    if (!parent || parent.archivedAt) parentId = null
  }

  const parentSegments = await getFolderRemoteSegments(parentId)
  const archivedRel = archivedFolderSegment(folder)
  const newRel = [...parentSegments, remoteSegment(folder.name)].join("/")

  // 1. MOVE físico de vuelta desde Archivados.
  try {
    await moveSstFolder(
      `storage/sst-documents/${archivedRel}`,
      `storage/sst-documents/${newRel}`,
    )
  } catch (error) {
    logger.error("[documents-library] no se pudo restaurar la carpeta en el storage", error)
    throw new Error("No se pudo restaurar la carpeta en el almacenamiento.")
  }

  // 2. Reescribe los paths guardados (inverso del archive).
  try {
    await rewriteVersionPaths(
      archivedRel,
      newRel,
      sql`${sstDocumentVersions.filePath} LIKE ${`storage/sst-documents/${archivedRel}/%`}`,
    )
  } catch (_error) {
    await moveSstFolder(
      `storage/sst-documents/${newRel}`,
      `storage/sst-documents/${archivedRel}`,
    ).catch((revertError) => {
      logger.error("[documents-library] no se pudo revertir la restauración tras fallo de BD", revertError)
    })
    throw new Error("No se pudo restaurar la carpeta (los archivos no se actualizaron).")
  }

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocumentFolders)
    .set({ archivedAt: null, parentId, updatedAt: now })
    .where(eq(sstDocumentFolders.id, folder.id))
    .returning()
  if (!updated) throw new Error("No se pudo restaurar la carpeta.")
  return updated
}
