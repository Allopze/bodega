import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments } from "@/db/schema"
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

function normalizeNullableId(value: string | null | undefined) {
  return value ? value : null
}

async function getFolderOrThrow(id: string, scope: WorksiteScope) {
  const [folder] = await db.select().from(sstDocumentFolders).where(eq(sstDocumentFolders.id, id)).limit(1)
  if (!folder || folder.archivedAt) throw new Error("Carpeta no encontrada.")
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
  if (parent?.worksiteId !== folder.worksiteId) throw new Error("No se puede mover la carpeta a otra faena.")
  const descendantIds = await listFolderDescendantIds(data.id)
  if (!canMoveFolder({ folderId: data.id, targetParentId: parentId, descendantIds })) {
    throw new Error("No se puede mover una carpeta dentro de sí misma.")
  }

  const [updated] = await db.update(sstDocumentFolders)
    .set({ parentId, updatedAt: new Date().toISOString() })
    .where(eq(sstDocumentFolders.id, data.id))
    .returning()
  if (!updated) throw new Error("No se pudo mover la carpeta.")
  return updated
}

export async function moveDocumentToFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentMoveSchema.parse(args.input)
  const folderId = normalizeNullableId(data.folderId)
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, data.id)).limit(1)
  if (!doc) throw new Error("Documento no encontrado.")
  assertScopeAccess(doc.worksiteId, args.scope)
  const folder = await assertParent(folderId, args.scope)
  if (folder && folder.worksiteId !== doc.worksiteId) throw new Error("No se puede mover el documento a otra faena.")

  const [updated] = await db.update(sstDocuments)
    .set({ folderId, updatedAt: new Date().toISOString() })
    .where(eq(sstDocuments.id, data.id))
    .returning()
  if (!updated) throw new Error("No se pudo mover el documento.")
  await recordAuditEntry({ documentId: doc.id, userId: args.ctx.userId, action: "edit", metadata: { folderId } })
  return updated
}
