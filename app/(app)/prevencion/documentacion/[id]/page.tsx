import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentBundle } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites, workers, fuelVehicles } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
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
  const bundle = await getDocumentBundle(id, scope)
  if (!bundle) redirect("/prevencion/documentacion")

  // Hidratar nombres de usuarios y obras para la UI.
  const userIds = Array.from(new Set([
    bundle.doc.uploadedBy,
    bundle.doc.reviewedBy ?? "",
    bundle.doc.approvedBy ?? "",
    bundle.doc.responsibleUserId ?? "",
    ...bundle.versions.map((v) => v.uploadedBy),
    ...bundle.versions.map((v) => v.reviewedBy ?? ""),
    ...bundle.versions.map((v) => v.approvedBy ?? ""),
    ...bundle.audit.map((a) => a.userId ?? ""),
    ...bundle.acks.map((a) => a.userId),
  ].filter(Boolean) as string[]))

  const worksiteIds = Array.from(new Set([
    bundle.doc.worksiteId ?? "",
    ...bundle.links.filter((l) => l.entityType === "worksite").map((l) => l.entityId),
  ].filter(Boolean) as string[]))

  // Hidratar entidades linkeadas: nombre legible según entityType.
  const linkIdsByType: Record<string, string[]> = {}
  for (const link of bundle.links) {
    const list = linkIdsByType[link.entityType] ?? (linkIdsByType[link.entityType] = [])
    list.push(link.entityId)
  }

  const [userRows, worksiteRows, workerRows, vehicleRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    linkIdsByType.worker?.length ? db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName }).from(workers).where(inArray(workers.id, linkIdsByType.worker)) : Promise.resolve([] as Array<{ id: string; firstName: string; lastName: string }>),
    linkIdsByType.vehicle?.length ? db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate }).from(fuelVehicles).where(inArray(fuelVehicles.id, linkIdsByType.vehicle)) : Promise.resolve([] as Array<{ id: string; plate: string }>),
  ])

  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w]))

  const linkEnrichment: Record<string, Record<string, string>> = {}
  if (workerRows.length) {
    linkEnrichment.worker = Object.fromEntries(workerRows.map((w) => [w.id, `${w.firstName} ${w.lastName}`]))
  }
  if (vehicleRows.length) {
    linkEnrichment.vehicle = Object.fromEntries(vehicleRows.map((v) => [v.id, v.plate]))
  }

  const canManage = can(session, "prevention:docs:manage")
  const canApprove = can(session, "prevention:docs:approve")
  const canArchive = can(session, "prevention:docs:archive")
  const canAck = can(session, "prevention:docs:ack")
  const canLink = can(session, "prevention:docs:link")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={bundle.doc.title}
        description={`${bundle.doc.internalCode ?? "—"} · ${bundle.doc.categorySlug} · ${bundle.doc.status}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación", href: "/prevencion/documentacion" },
          { label: bundle.doc.title.slice(0, 48) },
        ]} />}
      />
      <DocumentDetailView
        bundle={bundle}
        userMap={userMap}
        worksiteMap={worksiteMap}
        linkEnrichment={linkEnrichment}
        canManage={canManage}
        canApprove={canApprove}
        canArchive={canArchive}
        canAck={canAck}
        canLink={canLink}
        currentUserId={session.user.id}
        currentUserName={userMap[session.user.id]?.name ?? session.user.email ?? "Yo"}
      />
    </PageContainer>
  )
}
