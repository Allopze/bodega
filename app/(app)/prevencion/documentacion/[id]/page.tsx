import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getDocumentBundle,
  listDocumentCategories,
  listDocumentRecipientOptions,
  listDocumentTypes,
} from "@/lib/services/prevention-documents-library"
import { listRiohsRolloutStatus, listRiohsRolloutWorksiteIds } from "@/lib/services/pdtp-adapters/riohs-rollout-connector"
import { db } from "@/db"
import { sstDocumentTypes, users, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { DocumentDetailView } from "./document-detail-view"
import { RiohsChecklist } from "./riohs-checklist"
import { ClassifyDocumentDialog } from "./classify-document-dialog"
import { RiohsRolloutCard, type RiohsRolloutRow } from "./riohs-rollout-card"
import { RIOHS_DOCUMENT_TYPE_CODE, type RiohsMetadata } from "@/lib/prevention/riohs"
import { and, asc, eq as eqOp } from "drizzle-orm"

export const metadata: Metadata = { title: "Detalle documental SST" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function DocumentDetailPage({ params }: Props) {
  const { id } = await params

  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/documentacion")}`) }
  if (!can(session, "prevention:docs:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/documentacion")}`)

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

  // El Reglamento Interno tiene un contenido mínimo exigido (DS 44 art. 58) que
  // el gate de publicación verifica; acá se declara.
  const [docType] = bundle.doc.typeId
    ? await db.select({ code: sstDocumentTypes.code }).from(sstDocumentTypes).where(eqOp(sstDocumentTypes.id, bundle.doc.typeId))
    : [undefined]
  const isRiohs = docType?.code === RIOHS_DOCUMENT_TYPE_CODE
  const riohsSections = ((bundle.doc.extraMetadata ?? {}) as RiohsMetadata).riohsSections ?? []

  const canManage = can(session, "prevention:docs:manage")
  const canArchive = can(session, "prevention:docs:archive")
  const currentVersion = bundle.versions.find((version) => version.id === bundle.doc.currentVersionId) ?? null

  // Clasificar: los mismos tipos y faenas que ofrece la subida tipada.
  const [types, categories, visibleWorksites] = canManage
    ? await Promise.all([
        listDocumentTypes(),
        listDocumentCategories(),
        scope.mode === "none"
          ? Promise.resolve([] as Array<{ id: string; name: string }>)
          : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
            .where(scope.mode === "all"
              ? eqOp(worksites.isActive, true)
              : and(eqOp(worksites.isActive, true), inArray(worksites.id, scope.ids)))
            .orderBy(asc(worksites.name)),
      ])
    : [[], [], []] as [
        Awaited<ReturnType<typeof listDocumentTypes>>,
        Awaited<ReturnType<typeof listDocumentCategories>>,
        Array<{ id: string; name: string }>,
      ]
  const categoryName = new Map(categories.map((category) => [category.slug, category.name]))
  const typeOptions = types.map((type) => ({
    id: type.id,
    name: type.name,
    code: type.code,
    categoryName: categoryName.get(type.categorySlug) ?? type.categorySlug,
    requiresApproval: type.requiresApproval,
    defaultValidityMonths: type.defaultValidityMonths,
  }))

  // N°18: entrega de la versión vigente del RIOHS a la dotación, por faena.
  let rolloutRows: RiohsRolloutRow[] = []
  if (isRiohs && currentVersion?.status === "vigente") {
    const candidates = await listRiohsRolloutWorksiteIds(bundle.doc.worksiteId)
    const inScope = scope.mode === "all" ? candidates : candidates.filter((id) => scope.mode === "some" && scope.ids.includes(id))
    const status = await listRiohsRolloutStatus(currentVersion.id, inScope)
    rolloutRows = status.map((row) => ({
      ...row,
      pendingTargetIds: bundle.distribution
        .filter((target) => target.versionId === currentVersion.id && target.status === "pendiente" && target.worksiteId === row.worksiteId)
        .map((target) => target.id),
    }))
  }

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
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canManage && bundle.doc.status !== "archivado" ? (
              <ClassifyDocumentDialog
                documentId={id}
                currentTypeId={bundle.doc.typeId}
                currentWorksiteId={bundle.doc.worksiteId}
                types={typeOptions}
                worksites={visibleWorksites}
                canUseCorporate={scope.mode === "all"}
              />
            ) : null}
            <Button asChild size="sm" variant="secondary"><a href={`/api/prevencion/documentacion/${id}/expediente`} download>Exportar expediente Excel</a></Button>
          </div>
        )}
      />
      {isRiohs && (
        <RiohsChecklist documentId={id} currentVersionId={bundle.doc.currentVersionId} sections={riohsSections} canManage={canManage} canDistribute={canDistribute} />
      )}
      {isRiohs && currentVersion?.status === "vigente" && (
        <RiohsRolloutCard
          documentId={id}
          versionId={currentVersion.id}
          versionNumber={currentVersion.version}
          rows={rolloutRows}
          canDistribute={canDistribute}
        />
      )}
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
