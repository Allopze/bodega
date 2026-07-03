import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments } from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  sstDocumentFolderCreateSchema,
  sstDocumentFolderMoveSchema,
  sstDocumentFolderUpdateSchema,
  sstDocumentMoveSchema,
} from "@/lib/validation/prevention"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  assertScopeAccess,
  buildFolderBreadcrumbs,
  canMoveFolder,
  folderSlug,
  normalizeFolderName,
  recordAuditEntry,
  type RequestContext,
} from "./utils"

type FolderRow = typeof sstDocumentFolders.$inferSelect

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

export async function archiveDocumentFolder(args: {
  input: { id: string }
  ctx: RequestContext
  scope: WorksiteScope
}) {
  const folder = await getFolderOrThrow(args.input.id, args.scope)
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

  const now = new Date().toISOString()
  const [updated] = await db.update(sstDocumentFolders)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(sstDocumentFolders.id, folder.id))
    .returning()
  if (!updated) throw new Error("No se pudo restaurar la carpeta.")
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

export async function getFolderPath(folderId: string | null | undefined, scope: WorksiteScope): Promise<FolderRow[]> {
  if (!folderId) return []
  const path: FolderRow[] = []
  let currentId: string | null = folderId
  const visited = new Set<string>()
  while (currentId) {
    if (visited.has(currentId)) throw new Error("Jerarquía de carpetas inválida.")
    visited.add(currentId)
    const folder = await getFolderOrThrow(currentId, scope)
    path.unshift(folder)
    currentId = folder.parentId
  }
  return path
}

export async function getFolderBreadcrumbItems(folderId: string | null | undefined, scope: WorksiteScope) {
  const path = await getFolderPath(folderId, scope)
  return buildFolderBreadcrumbs(path.map((folder) => ({ id: folder.id, name: folder.name })))
}

export async function listDocumentFolders(args: {
  parentId?: string | null
  scope: WorksiteScope
  includeArchived?: boolean
}) {
  const parentId = normalizeNullableId(args.parentId)
  const conditions: (SQL | undefined)[] = [
    parentId ? eq(sstDocumentFolders.parentId, parentId) : isNull(sstDocumentFolders.parentId),
    args.includeArchived ? isNotNull(sstDocumentFolders.archivedAt) : isNull(sstDocumentFolders.archivedAt),
  ]
  if (args.scope.mode === "some") {
    conditions.push(or(inArray(sstDocumentFolders.worksiteId, args.scope.ids), isNull(sstDocumentFolders.worksiteId)))
  } else if (args.scope.mode === "none") {
    conditions.push(isNull(sstDocumentFolders.worksiteId))
  }
  return db.select().from(sstDocumentFolders).where(and(...conditions)).orderBy(asc(sstDocumentFolders.name))
}

/**
 * Get-or-create idempotente para carpetas raíz creadas por procesos de
 * sistema (p.ej. copia automática de evaluaciones SST). El slug incluye el
 * worksiteId porque `sst_document_folders_parent_slug_unique` es (parentId,
 * slug) sin worksiteId — sin esto, una carpeta "Evaluaciones SST" para la
 * faena A chocaría con la de la faena B. `worksiteId` es obligatorio (no
 * null) para que `assertScopeAccess` no bloquee a prevencionistas con
 * alcance restringido a una faena cuando naveguen a la carpeta.
 */
export async function getOrCreateSystemFolder(args: {
  name: string
  worksiteId: string
  createdBy: string
}): Promise<FolderRow> {
  const name = normalizeFolderName(args.name)
  const slug = `${folderSlug(name)}--${args.worksiteId}`
  const now = new Date().toISOString()
  await db.insert(sstDocumentFolders).values({
    id: `sdf-${nanoid()}`,
    parentId: null,
    name,
    slug,
    worksiteId: args.worksiteId,
    createdBy: args.createdBy,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing()
  const [folder] = await db.select().from(sstDocumentFolders)
    .where(and(isNull(sstDocumentFolders.parentId), eq(sstDocumentFolders.slug, slug)))
    .limit(1)
  if (!folder) throw new Error("No se pudo crear u obtener la carpeta del sistema.")
  return folder
}

export async function listFolderOptions(scope: WorksiteScope) {
  const conditions: (SQL | undefined)[] = [isNull(sstDocumentFolders.archivedAt)]
  if (scope.mode === "some") conditions.push(or(inArray(sstDocumentFolders.worksiteId, scope.ids), isNull(sstDocumentFolders.worksiteId)))
  if (scope.mode === "none") conditions.push(isNull(sstDocumentFolders.worksiteId))
  return db.select().from(sstDocumentFolders).where(and(...conditions)).orderBy(asc(sstDocumentFolders.name))
}
