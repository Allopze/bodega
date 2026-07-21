import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listArchivedDocumentFolders, searchDocuments } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { sstDocumentVersions, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PapeleraView } from "./papelera-view"

export const metadata: Metadata = { title: "Papelera · Documentación" }

export default async function PapeleraPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)

  const [archivedFolders, archivedDocs] = await Promise.all([
    listArchivedDocumentFolders(scope),
    searchDocuments({ status: "archivado", page: 1, pageSize: 200 }, scope, session.user.permissions),
  ])

  const worksiteIds = Array.from(new Set([
    ...archivedFolders.flatMap((f) => f.worksiteId ? [f.worksiteId] : []),
    ...archivedDocs.rows.flatMap((d) => d.worksiteId ? [d.worksiteId] : []),
  ]))
  const versionIds = Array.from(new Set(
    archivedDocs.rows.flatMap((d) => d.currentVersionId ? [d.currentVersionId] : []),
  ))
  const [worksiteRows, versionRows] = await Promise.all([
    worksiteIds.length
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    versionIds.length
      ? db.select({
          id: sstDocumentVersions.id,
          fileName: sstDocumentVersions.fileName,
          mimeType: sstDocumentVersions.mimeType,
        }).from(sstDocumentVersions).where(inArray(sstDocumentVersions.id, versionIds))
      : Promise.resolve([] as Array<{ id: string; fileName: string; mimeType: string }>),
  ])
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w.name]))
  const versionMap = Object.fromEntries(versionRows.map((v) => [v.id, v]))

  const folders = archivedFolders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    worksiteName: f.worksiteId ? worksiteMap[f.worksiteId] ?? null : null,
    archivedAt: f.archivedAt,
    updatedAt: f.updatedAt,
  }))
  const documents = archivedDocs.rows.map((d) => {
    const version = d.currentVersionId ? versionMap[d.currentVersionId] : null
    return {
      id: d.id,
      title: d.title,
      internalCode: d.internalCode,
      worksiteName: d.worksiteId ? worksiteMap[d.worksiteId] ?? null : null,
      fileName: version?.fileName ?? null,
      mimeType: version?.mimeType ?? null,
      updatedAt: d.updatedAt,
    }
  })

  const canRestore = can(session, "prevention:docs:archive")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Papelera"
        description="Carpetas y documentos archivados. Restaura lo que necesites recuperar."
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación", href: "/prevencion/documentacion" }, { label: "Papelera" }]} />}
      />
      <PapeleraView
        folders={folders}
        documents={documents}
        canRestore={canRestore}
        userId={session.user.id}
      />
    </PageContainer>
  )
}
