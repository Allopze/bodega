import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  searchDocuments,
  listDocumentFolders,
  listFolderOptions,
  getFolderBreadcrumbItems,
  getDashboardCounters,
} from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { sstDocumentVersions, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { DocumentacionHeaderActions } from "./documentacion-header-actions"
import { DocumentacionView } from "./documentacion-view"

export const metadata: Metadata = { title: "Documentación" }

export default async function DocumentacionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; folder?: string; page?: string }>
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
  const hasSearch = Boolean(params.q)
  const documentFolderId = activeFolderId ?? (hasSearch ? undefined : null)

  const [folders, folderOptions, breadcrumbs, counters, searchResult] = await Promise.all([
    hasSearch && !activeFolderId
      ? Promise.resolve([])
      : listDocumentFolders({ parentId: activeFolderId, scope }),
    listFolderOptions(scope),
    getFolderBreadcrumbItems(activeFolderId, scope),
    getDashboardCounters(scope, session.user.permissions),
    searchDocuments({
      q: params.q ?? "",
      folderId: documentFolderId,
      page,
      pageSize,
    }, scope, session.user.permissions),
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
  const canRegularize = can(session, "prevention:docs:publish")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Documentación"
        description="Biblioteca de archivos y carpetas preventivas."
        breadcrumb={<Breadcrumbs items={breadcrumbs} />}
        actions={canManage || canRegularize ? (
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? <DocumentacionHeaderActions currentFolderId={activeFolderId} /> : null}
            {canRegularize ? (
              <Button asChild size="sm" variant="secondary">
                <Link href="/prevencion/documentacion/regularizacion">Regularización</Link>
              </Button>
            ) : null}
          </div>
        ) : undefined}
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
