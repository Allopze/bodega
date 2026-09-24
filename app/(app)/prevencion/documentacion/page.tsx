import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { and, asc, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  searchDocuments,
  listDocumentFolders,
  listFolderOptions,
  getFolderBreadcrumbItems,
  getDashboardCounters,
  listDocumentCategories,
  listDocumentTypes,
} from "@/lib/services/prevention-documents-library"
import { getPdtpLegalFolderOverview } from "@/lib/services/pdtp-adapters/legal-folder-connector"
import { db } from "@/db"
import { sstDocumentFolders, sstDocumentVersions, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { DocumentacionHeaderActions } from "./documentacion-header-actions"
import { DocumentacionView } from "./documentacion-view"
import { expiryFilterInput, parseExpiryFilter } from "./expiry-filter"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"
import { LegalFolderPanel, type LegalFolderPanelData } from "./legal-folder-panel"

export const metadata: Metadata = { title: "Registro documental" }

export default async function DocumentacionPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    folder?: string
    page?: string
    vence?: string
    /** Llegada desde el programa preventivo: faena y tipo a declarar. */
    faena?: string
    tipo?: string
    /** `requisitos-legales`: muestra la carpeta N°19 de la faena. */
    carpeta?: string
  }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const params = await searchParams

  // TASK-UI-006: el indicador "Documentos por vencer" señalaba una urgencia que
  // su destino no sabía acotar. `searchDocuments` ya admitía el rango; sólo
  // faltaba que la pantalla lo aceptara desde la URL.
  const expiryFilter = parseExpiryFilter(params.vence)
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
    // Un enlace guardado a una carpeta hoy archivada no debe botar la página:
    // se degrada al breadcrumb de la raíz.
    getFolderBreadcrumbItems(activeFolderId, scope).catch(() => getFolderBreadcrumbItems(null, scope)),
    getDashboardCounters(scope, session.user.permissions),
    searchDocuments({
      q: params.q ?? "",
      // Un filtro por vencimiento recorre toda la documentación: acotarlo a la
      // carpeta abierta devolvería menos de lo que el indicador promete.
      folderId: expiryFilter ? undefined : documentFolderId,
      page,
      pageSize,
      ...expiryFilterInput(expiryFilter),
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

  // Subida tipada: tipos activos, faenas que la persona ve y la faena de la
  // carpeta abierta (lo que se sube ahí es de esa faena).
  const [types, categories, visibleWorksites, [currentFolder]] = await Promise.all([
    listDocumentTypes(),
    listDocumentCategories(),
    scope.mode === "none"
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(scope.mode === "all"
          ? eq(worksites.isActive, true)
          : and(eq(worksites.isActive, true), inArray(worksites.id, scope.ids)))
        .orderBy(asc(worksites.name)),
    activeFolderId
      ? db.select({ worksiteId: sstDocumentFolders.worksiteId }).from(sstDocumentFolders)
        .where(eq(sstDocumentFolders.id, activeFolderId)).limit(1)
      : Promise.resolve([] as Array<{ worksiteId: string | null }>),
  ])
  const categoryName = new Map(categories.map((category) => [category.slug, category.name]))
  const typeOptions = types.map((type) => ({
    id: type.id,
    name: type.name,
    code: type.code,
    categoryName: categoryName.get(type.categorySlug) ?? type.categorySlug,
    requiresApproval: type.requiresApproval,
    defaultValidityMonths: type.defaultValidityMonths,
  }))
  const requestedWorksite = params.faena && visibleWorksites.some((site) => site.id === params.faena) ? params.faena : null
  const requestedType = params.tipo && types.some((type) => type.id === params.tipo) ? params.tipo : undefined

  // Carpeta de requisitos legales (N°19): se abre desde el programa preventivo
  // con `?carpeta=requisitos-legales&faena=…`.
  const showLegalFolder = params.carpeta === "requisitos-legales"
  let legalFolder: LegalFolderPanelData | null = null
  if (showLegalFolder) {
    const folderWorksite = requestedWorksite ?? (visibleWorksites.length === 1 ? visibleWorksites[0]!.id : null)
    const overview = folderWorksite ? await getPdtpLegalFolderOverview(folderWorksite) : null
    if (overview && folderWorksite) {
      legalFolder = {
        activityNumber: overview.activity.n,
        worksiteId: folderWorksite,
        assessment: overview.assessment,
        month: overview.month,
      }
    }
  }

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Registro documental"
        description="Biblioteca de archivos y carpetas preventivas."
        breadcrumb={<Breadcrumbs items={breadcrumbs} />}
        actions={canManage || canRegularize ? (
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <DocumentacionHeaderActions
                currentFolderId={activeFolderId}
                folderWorksiteId={currentFolder?.worksiteId ?? null}
                documentTypes={typeOptions}
                worksites={visibleWorksites}
                canUploadCorporate={scope.mode === "all"}
                initialTypeId={requestedType}
                initialWorksiteId={requestedWorksite}
              />
            ) : null}
            {canRegularize ? (
              <Button asChild size="sm" variant="secondary">
                <Link href="/prevencion/documentacion/regularizacion">Regularización</Link>
              </Button>
            ) : null}
          </div>
        ) : undefined}
      />
      {showLegalFolder && (
        <LegalFolderPanel
          data={legalFolder}
          worksites={visibleWorksites}
          types={typeOptions}
          canManage={canManage}
          canUploadCorporate={scope.mode === "all"}
        />
      )}
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
      <PdtpScheduledActivityPanelServer connectorKey="documentation" />
    </PageContainer>
  )
}
