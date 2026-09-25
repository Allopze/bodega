import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments, sstDocumentVersions } from "@/db/schema"
import { logger } from "@/lib/logger"
import {
  sstDocumentFolderMoveSchema,
  sstDocumentMoveSchema,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  assertScopeAccess,
  canMoveFolder,
  recordAuditEntry,
  type RequestContext,
} from "./utils"
import { getFolderRemoteSegments } from "./folder-storage"
import { moveSstFolder } from "@/lib/storage/sst-folders"
import { moveSstDocument } from "@/lib/storage/sst-backend"
import { remoteSegment, sstPrefixReplace } from "@/lib/services/cloudreve/sst-path"
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

export async function listFolderDescendantIds(folderId: string): Promise<string[]> {
  const descendants: string[] = []
  let frontier = [folderId]
  while (frontier.length) {
    const rows = await db.select({ id: sstDocumentFolders.id })
      .from(sstDocumentFolders)
      .where(inArray(sstDocumentFolders.parentId, frontier))
    frontier = rows.map((row) => row.id)
    descendants.push(...frontier)
  }
  return descendants
}

export async function moveDocumentFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentFolderMoveSchema.parse(args.input)
  const parentId = normalizeNullableId(data.parentId)
  const folder = await getFolderOrThrow(data.id, args.scope)
  const parent = await assertParent(parentId, args.scope)
  // Sólo un padre impone faena: en la raíz la carpeta conserva la suya. Antes
  // `undefined !== worksiteId` rechazaba siempre volver a la raíz.
  if (parent && parent.worksiteId !== folder.worksiteId) throw new PreventionDocumentDomainError("No se puede mover la carpeta a otra faena.")
  const descendantIds = await listFolderDescendantIds(data.id)
  if (!canMoveFolder({ folderId: data.id, targetParentId: parentId, descendantIds })) {
    throw new PreventionDocumentDomainError("No se puede mover una carpeta dentro de sí misma.")
  }

  const oldSegments = await getFolderRemoteSegments(data.id)
  const parentSegments = await getFolderRemoteSegments(parentId)
  const oldRel = oldSegments.join("/")
  const newRel = [...parentSegments, remoteSegment(folder.name)].join("/")

  if (oldRel !== newRel) {
    // 1. MOVE físico de la colección.
    try {
      await moveSstFolder(
        `storage/sst-documents/${oldRel}`,
        `storage/sst-documents/${newRel}`,
      )
    } catch (error) {
      logger.error("[documents-library] no se pudo mover la carpeta en el storage", error)
      throw new Error("No se pudo mover la carpeta en el almacenamiento.")
    }
  }

  // 2. Reescribe los paths guardados de las versiones del subárbol.
  if (oldRel !== newRel) {
    try {
      const versions = await db
        .select({ id: sstDocumentVersions.id, filePath: sstDocumentVersions.filePath })
        .from(sstDocumentVersions)
        .innerJoin(sstDocuments, eq(sstDocumentVersions.documentId, sstDocuments.id))
        .where(inArray(sstDocuments.folderId, [data.id, ...descendantIds]))
      for (const version of versions) {
        const rewritten = sstPrefixReplace(version.filePath, oldRel, newRel)
        if (!rewritten) continue
        await db.update(sstDocumentVersions)
          .set({ filePath: rewritten, updatedAt: new Date().toISOString() })
          .where(eq(sstDocumentVersions.id, version.id))
      }
    } catch (_error) {
      await moveSstFolder(
        `storage/sst-documents/${newRel}`,
        `storage/sst-documents/${oldRel}`,
      ).catch((revertError) => {
        logger.error("[documents-library] no se pudo revertir el MOVE de carpeta tras fallo de BD", revertError)
      })
      throw new Error("No se pudo mover la carpeta (los archivos no se actualizaron).")
    }
  }

  const [updated] = await db.update(sstDocumentFolders)
    .set({ parentId, updatedAt: new Date().toISOString() })
    .where(eq(sstDocumentFolders.id, data.id))
    .returning()
  if (!updated) throw new Error("No se pudo mover la carpeta.")
  return updated
}

/**
 * Mueve los archivos de TODAS las versiones de un documento de un prefijo a
 * otro (una por una, con UPDATE del filePath). Si un MOVE falla, se revierten
 * los ya movidos y no se toca `sstDocuments.folderId`.
 */
export async function relocateDocumentFiles(
  docId: string,
  fromSegments: readonly string[],
  toSegments: readonly string[],
): Promise<void> {
  const fromRel = fromSegments.join("/")
  const toRel = toSegments.join("/")
  if (fromRel === toRel) return

  const versions = await db
    .select({ id: sstDocumentVersions.id, filePath: sstDocumentVersions.filePath })
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.documentId, docId))

  const moved: Array<{ id: string; from: string; to: string }> = []
  try {
    for (const version of versions) {
      const rewritten = sstPrefixReplace(version.filePath, fromRel, toRel)
      if (!rewritten) continue
      await moveSstDocument(version.filePath, rewritten)
      await db.update(sstDocumentVersions)
        .set({ filePath: rewritten, updatedAt: new Date().toISOString() })
        .where(eq(sstDocumentVersions.id, version.id))
      moved.push({ id: version.id, from: version.filePath, to: rewritten })
    }
  } catch (_error) {
    // Compensación: devolver lo ya movido y dejar todo como estaba.
    for (const entry of moved.reverse()) {
      await moveSstDocument(entry.to, entry.from).catch(() => undefined)
      await db.update(sstDocumentVersions)
        .set({ filePath: entry.from, updatedAt: new Date().toISOString() })
        .where(eq(sstDocumentVersions.id, entry.id))
        .catch(() => undefined)
    }
    throw new Error("No se pudo mover los archivos del documento.")
  }
}

export async function moveDocumentToFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentMoveSchema.parse(args.input)
  const folderId = normalizeNullableId(data.folderId)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.id)).limit(1)
  if (!doc) throw new PreventionDocumentDomainError("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  const folder = await assertParent(folderId, args.scope)
  if (folder && folder.worksiteId !== doc.worksiteId) throw new PreventionDocumentDomainError("No se puede mover el documento a otra faena.")

  const fromSegments = await getFolderRemoteSegments(doc.folderId)
  const toSegments = await getFolderRemoteSegments(folderId)

  // Mueve los archivos físicos ANTES de actualizar el folderId del documento.
  await relocateDocumentFiles(doc.id, fromSegments, toSegments)

  const [updated] = await db.update(sstDocuments)
    .set({ folderId, updatedAt: new Date().toISOString() })
    .where(eq(sstDocuments.id, data.id))
    .returning()
  if (!updated) throw new Error("No se pudo mover el documento.")
  await recordAuditEntry({ documentId: doc.id, userId: args.ctx.userId, action: "edit", metadata: { folderId } })
  return updated
}
