import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getDashboardCounters,
  getExpiringDocuments,
  searchDocuments,
  listDocumentCategories,
  listDocumentTypes,
  listDocumentFolders,
  listFolderOptions,
  getFolderBreadcrumbItems,
} from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { DocumentacionView } from "./documentacion-view"

export const metadata: Metadata = { title: "Documentación" }

export default async function DocumentacionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; worksiteId?: string; folder?: string }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const params = await searchParams

  const activeFolderId = params.folder || null

  const [counters, expiring, categories, types, folders, folderOptions, breadcrumbs, searchResult] = await Promise.all([
    getDashboardCounters(scope),
    getExpiringDocuments(scope, 30, 50),
    listDocumentCategories(true),
    listDocumentTypes(),
    listDocumentFolders({ parentId: activeFolderId, scope, includeArchived: params.status === "archivado" }),
    listFolderOptions(scope),
    getFolderBreadcrumbItems(activeFolderId, scope),
    searchDocuments({
      q: params.q ?? "",
      folderId: activeFolderId,
      categorySlug: (params.category as never) ?? "",
      status: (params.status as never) ?? "",
      worksiteId: params.worksiteId ?? "",
      page: 1,
      pageSize: 50,
    }, scope),
  ])

  // Hidratar obras y usuarios.
  const worksiteIds = Array.from(new Set([
    ...searchResult.rows.map((r) => r.worksiteId).filter(Boolean) as string[],
    ...expiring.map((e) => e.worksiteId).filter(Boolean) as string[],
  ]))
  const userIds = Array.from(new Set([
    ...searchResult.rows.map((r) => r.responsibleUserId).filter(Boolean) as string[],
    ...searchResult.rows.map((r) => r.uploadedBy).filter(Boolean) as string[],
    ...searchResult.rows.map((r) => r.approvedBy).filter(Boolean) as string[],
    ...expiring.map((e) => e.responsibleUserId).filter(Boolean) as string[],
  ]))

  const [worksiteRows, userRows] = await Promise.all([
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])

  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w.name]))
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u.name]))

  // Calculamos los días para vencer una sola vez (en el Server Component, antes de
  // pasar el dato al cliente) para evitar impureza durante el render.
  // eslint-disable-next-line react-hooks/purity -- server-side data prep
  const nowMs = Date.now()
  const docsWithRefs = searchResult.rows.map((d) => ({
    ...d,
    worksiteName: d.worksiteId ? worksiteMap[d.worksiteId] ?? null : null,
    responsibleName: d.responsibleUserId ? userMap[d.responsibleUserId] ?? null : null,
    uploaderName: userMap[d.uploadedBy] ?? null,
    daysUntilExpiry: d.expiresAt
      ? (Math.ceil((new Date(`${d.expiresAt}T00:00:00Z`).getTime() - nowMs) / (1000 * 60 * 60 * 24)))
      : null,
  }))

  const expiringWithRefs = expiring.map((e) => ({
    ...e,
    worksiteName: e.worksiteId ? worksiteMap[e.worksiteId] ?? null : null,
    responsibleName: e.responsibleUserId ? userMap[e.responsibleUserId] ?? null : null,
  }))

  const canManage = can(session, "prevention:docs:manage")
  const canApprove = can(session, "prevention:docs:approve")
  const canExport = can(session, "prevention:docs:export")
  const canAck = can(session, "prevention:docs:ack")
  const canArchive = can(session, "prevention:docs:archive")

  return (
    <PageContainer width="workbench">
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]} />
      <PageHeader
        title="Documentación"
        description="Repositorio de documentación preventiva. Vencimientos, versiones, aprobaciones y acuses."
        breadcrumb={<Breadcrumbs items={breadcrumbs} />}
        actions={
          canExport ? (
            <PreventionExportButton
              href="/api/prevencion/documentacion/export"
              label="Exportar XLSX"
            />
          ) : undefined
        }
      />
      <DocumentacionView
        counters={counters}
        expiring={expiringWithRefs}
        documents={docsWithRefs}
        folders={folders}
        folderOptions={folderOptions}
        breadcrumbs={breadcrumbs}
        currentFolderId={activeFolderId}
        categories={categories}
        types={types}
        searchParams={params}
        total={searchResult.total}
        canManage={canManage}
        canApprove={canApprove}
        canAck={canAck}
        canArchive={canArchive}
      />
    </PageContainer>
  )
}
