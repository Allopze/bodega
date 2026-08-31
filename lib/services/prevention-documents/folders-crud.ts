import { and, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments } from "@/db/schema"
import { nanoid } from "@/lib/id"
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
  return folder
}

export async function renameDocumentFolder(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const data = sstDocumentFolderUpdateSchema.parse(args.input)
  await getFolderOrThrow(data.id, args.scope)
  const name = normalizeFolderName(data.name)
  const [folder] = await db.update(sstDocumentFolders)
    .set({ name, slug: folderSlug(name), updatedAt: new Date().toISOString() })
    .where(eq(sstDocumentFolders.id, data.id))
    .returning()
  if (!folder) throw new Error("No se pudo renombrar la carpeta.")
  return folder
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
    throw new Error("La carpeta tiene subcarpetas o documentos activos. Muévelos o archívalos antes de archivar la carpeta.")
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
  if (!folder || !folder.archivedAt) throw new Error("Carpeta archivada no encontrada.")
  assertScopeAccess(folder.worksiteId, args.scope)

  // Restaurar bajo un padre aún archivado dejaría la carpeta huérfana (invisible
  // en el árbol y con breadcrumb roto): se re-cuelga en la raíz.
  let parentId = folder.parentId
  if (parentId) {
    const [parent] = await db.select({ archivedAt: sstDocumentFolders.archivedAt })
      .from(sstDocumentFolders).where(eq(sstDocumentFolders.id, parentId)).limit(1)
    if (!parent || parent.archivedAt) parentId = null
  }

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocumentFolders)
    .set({ archivedAt: null, parentId, updatedAt: now })
    .where(eq(sstDocumentFolders.id, folder.id))
    .returning()
  if (!updated) throw new Error("No se pudo restaurar la carpeta.")
  return updated
}
