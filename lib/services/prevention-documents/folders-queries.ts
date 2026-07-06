import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { type WorksiteScope } from "@/lib/auth/scope"
import {
  assertScopeAccess,
  buildFolderBreadcrumbs,
  folderSlug,
  normalizeFolderName,
} from "./utils"

type FolderRow = typeof sstDocumentFolders.$inferSelect

async function getFolderOrThrow(id: string, scope: WorksiteScope) {
  const [folder] = await db.select().from(sstDocumentFolders).where(eq(sstDocumentFolders.id, id)).limit(1)
  if (!folder || folder.archivedAt) throw new Error("Carpeta no encontrada.")
  assertScopeAccess(folder.worksiteId, scope)
  return folder
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

export async function listArchivedDocumentFolders(scope: WorksiteScope) {
  const conditions: (SQL | undefined)[] = [isNotNull(sstDocumentFolders.archivedAt)]
  if (scope.mode === "some") {
    conditions.push(or(inArray(sstDocumentFolders.worksiteId, scope.ids), isNull(sstDocumentFolders.worksiteId)))
  } else if (scope.mode === "none") {
    conditions.push(isNull(sstDocumentFolders.worksiteId))
  }
  return db.select().from(sstDocumentFolders).where(and(...conditions)).orderBy(asc(sstDocumentFolders.name))
}

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

function normalizeNullableId(value: string | null | undefined) {
  return value ? value : null
}
