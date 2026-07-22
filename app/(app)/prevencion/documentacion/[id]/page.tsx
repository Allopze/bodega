import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentBundle, listDocumentRecipientOptions } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { DocumentDetailView } from "./document-detail-view"

export const metadata: Metadata = { title: "Detalle documental SST" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function DocumentDetailPage({ params }: Props) {
  const { id } = await params

  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const bundle = await getDocumentBundle(id, scope, session.user.permissions)
  if (!bundle) redirect("/prevencion/documentacion")

  // Hidratar nombres mínimos para el visor y el historial de versiones.
  const userIds = Array.from(new Set([
    bundle.doc.uploadedBy,
    session.user.id,
    ...bundle.versions.map((v) => v.uploadedBy),
    ...bundle.versions.flatMap((v) => [v.reviewedBy, v.approvedBy]),
    ...bundle.distribution.flatMap((target) => [target.userId, target.assignedByUserId, target.exemptedByUserId]),
  ].filter(Boolean) as string[]))

  const worksiteIds = Array.from(new Set([
    bundle.doc.worksiteId ?? "",
  ].filter(Boolean) as string[]))

  const canDistribute = can(session, "prevention:docs:distribute")
  const [userRows, worksiteRows, recipientOptions] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    canDistribute ? listDocumentRecipientOptions(scope) : Promise.resolve([]),
  ])

  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w]))

  const canManage = can(session, "prevention:docs:manage")
  const canArchive = can(session, "prevention:docs:archive")
  const currentVersion = bundle.versions.find((version) => version.id === bundle.doc.currentVersionId) ?? null

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={bundle.doc.title}
        description={currentVersion?.fileName ?? "Archivo sin versión cargada"}
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación", href: "/prevencion/documentacion" },
          { label: bundle.doc.title.slice(0, 48) },
        ]} />}
        actions={<Button asChild size="sm" variant="secondary"><Link href={`/api/prevencion/documentacion/${id}/expediente`}>Exportar expediente Excel</Link></Button>}
      />
      <DocumentDetailView
        bundle={bundle}
        userMap={userMap}
        worksiteMap={worksiteMap}
        linkEnrichment={{}}
        canManage={canManage}
        canArchive={canArchive}
        canSubmitReview={can(session, "prevention:docs:submit_review")}
        canReview={can(session, "prevention:docs:review")}
        canApprove={can(session, "prevention:docs:approve")}
        canPublish={can(session, "prevention:docs:publish")}
        canDistribute={canDistribute}
        canAck={can(session, "prevention:docs:ack")}
        canLink={can(session, "prevention:docs:link")}
        recipientOptions={recipientOptions}
        currentUserId={session.user.id}
        currentUserName={userMap[session.user.id]?.name ?? session.user.email ?? "Yo"}
      />
    </PageContainer>
  )
}
