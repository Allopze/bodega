import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  searchDocuments,
  listDocumentFolders,
  listFolderOptions,
  getFolderBreadcrumbItems,
  listDocumentCategories,
  getDashboardCounters,
} from "@/lib/services/prevention-documents-library"
import { SST_DOCUMENT_CATEGORY_SLUGS, SST_DOCUMENT_STATUSES } from "@/lib/validation/prevention"
import { db } from "@/db"
import { sstDocumentVersions, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { DocumentacionHeaderActions } from "./documentacion-header-actions"
import { DocumentacionView } from "./documentacion-view"
import { DocumentacionFilters } from "./documentacion-filters"

export const metadata: Metadata = { title: "Documentación" }

export default async function DocumentacionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; worksiteId?: string; folder?: string; page?: string }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const params = await searchParams

  const activeFolderId = params.folder || null
  const page = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const category = SST_DOCUMENT_CATEGORY_SLUGS.includes(params.category as typeof SST_DOCUMENT_CATEGORY_SLUGS[number]) ? params.category as typeof SST_DOCUMENT_CATEGORY_SLUGS[number] : ""
  const status = SST_DOCUMENT_STATUSES.includes(params.status as typeof SST_DOCUMENT_STATUSES[number]) ? params.status as typeof SST_DOCUMENT_STATUSES[number] : ""
  const hasGlobalDocumentFilters = Boolean(params.q || category || status || params.worksiteId)
  const documentFolderId = activeFolderId ?? (hasGlobalDocumentFilters ? undefined : null)

  const [folders, folderOptions, breadcrumbs, categories, visibleWorksites, counters, searchResult] = await Promise.all([
    hasGlobalDocumentFilters && !activeFolderId
      ? Promise.resolve([])
      : listDocumentFolders({ parentId: activeFolderId, scope, includeArchived: params.status === "archivado" }),
    listFolderOptions(scope),
    getFolderBreadcrumbItems(activeFolderId, scope),
    listDocumentCategories(true),
    scope.mode === "none"
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(
        scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
      ),
    getDashboardCounters(scope),
    searchDocuments({
      q: params.q ?? "",
      folderId: documentFolderId,
      categorySlug: category,
      status,
      worksiteId: params.worksiteId ?? "",
      page,
      pageSize,
    }, scope),
  ])

  // Hidratar obras de carpetas y metadatos básicos de la versión vigente.
  const worksiteIds = Array.from(new Set([
    ...folders.flatMap((f) => f.worksiteId ? [f.worksiteId] : []),
  ]))
  const versionIds = Array.from(new Set(searchResult.rows.flatMap((r) => r.currentVersionId ? [r.currentVersionId] : [])))

  const [worksiteRows, versionRows] = await Promise.all([
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    versionIds.length ? db.select({
      id: sstDocumentVersions.id,
      fileName: sstDocumentVersions.fileName,
      mimeType: sstDocumentVersions.mimeType,
      fileSize: sstDocumentVersions.fileSize,
    }).from(sstDocumentVersions).where(inArray(sstDocumentVersions.id, versionIds)) : Promise.resolve([] as Array<{ id: string; fileName: string; mimeType: string; fileSize: number }>),
  ])

  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w.name]))
  const versionMap = Object.fromEntries(versionRows.map((v) => [v.id, v]))

  const docsWithRefs = searchResult.rows.map((d) => ({
    ...d,
    fileName: d.currentVersionId ? versionMap[d.currentVersionId]?.fileName ?? null : null,
    mimeType: d.currentVersionId ? versionMap[d.currentVersionId]?.mimeType ?? null : null,
    fileSize: d.currentVersionId ? versionMap[d.currentVersionId]?.fileSize ?? null : null,
  }))

  const foldersWithRefs = folders.map((f) => ({
    ...f,
    worksiteName: f.worksiteId ? worksiteMap[f.worksiteId] ?? null : null,
  }))

  const canManage = can(session, "prevention:docs:manage")
  const canArchive = can(session, "prevention:docs:archive")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Documentación"
        description="Biblioteca de archivos y carpetas preventivas."
        breadcrumb={<Breadcrumbs items={breadcrumbs} />}
        actions={canManage ? <DocumentacionHeaderActions currentFolderId={activeFolderId} /> : undefined}
      />
      <DocumentacionFilters
        query={params}
        categories={categories.map((category) => ({ slug: category.slug, name: category.name }))}
        worksites={visibleWorksites}
        total={searchResult.total}
        page={page}
        pageSize={pageSize}
      />
      <DocumentacionView
        counters={counters}
        documents={docsWithRefs}
        folders={foldersWithRefs}
        folderOptions={folderOptions}
        breadcrumbs={breadcrumbs}
        currentFolderId={activeFolderId}
        searchParams={params}
        total={searchResult.total}
        canManage={canManage}
        canArchive={canArchive}
        userId={session.user.id}
      />
    </PageContainer>
  )
}
