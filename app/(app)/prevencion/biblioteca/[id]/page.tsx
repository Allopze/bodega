import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentBundle } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites, trainingCourses, preventionIncidents, committees, emergencyPlans, preventionIncidentActions } from "@/db/schema"
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
  if (!bundle) redirect("/prevencion/biblioteca")

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
    ...bundle.links.filter((l) => l.entityType === "vehicle").map((l) => l.entityId),
  ].filter(Boolean) as string[]))

  const [userRows, worksiteRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])

  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w]))

  // Hidratar entidades linkeadas: nombre legible según entityType.
  const linkIdsByType: Record<string, string[]> = {}
  for (const link of bundle.links) {
    const list = linkIdsByType[link.entityType] ?? (linkIdsByType[link.entityType] = [])
    list.push(link.entityId)
  }
  const linkEnrichment: Record<string, Record<string, string>> = {}

  if (linkIdsByType.incident?.length) {
    const rows = await db.select({ id: preventionIncidents.id, title: preventionIncidents.title }).from(preventionIncidents).where(inArray(preventionIncidents.id, linkIdsByType.incident))
    linkEnrichment.incident = Object.fromEntries(rows.map((r) => [r.id, r.title]))
  }
  if (linkIdsByType.committee?.length) {
    // committees solo tiene id, worksiteId, type, status. Mostramos id + tipo.
    const rows = await db.select({ id: committees.id, type: committees.type, worksiteId: committees.worksiteId }).from(committees).where(inArray(committees.id, linkIdsByType.committee))
    linkEnrichment.committee = Object.fromEntries(rows.map((r) => [r.id, `Comité ${r.type} · ${r.worksiteId}`]))
  }
  if (linkIdsByType.emergency_plan?.length) {
    // emergencyPlans no tiene columna título: usamos id + versión.
    const rows = await db.select({ id: emergencyPlans.id, version: emergencyPlans.version, worksiteId: emergencyPlans.worksiteId }).from(emergencyPlans).where(inArray(emergencyPlans.id, linkIdsByType.emergency_plan))
    linkEnrichment.emergency_plan = Object.fromEntries(rows.map((r) => [r.id, `Plan de emergencia v${r.version} · ${r.worksiteId}`]))
  }
  if (linkIdsByType.corrective_action?.length) {
    const rows = await db.select({ id: preventionIncidentActions.id, description: preventionIncidentActions.description }).from(preventionIncidentActions).where(inArray(preventionIncidentActions.id, linkIdsByType.corrective_action))
    linkEnrichment.corrective_action = Object.fromEntries(rows.map((r) => [r.id, r.description.slice(0, 80)]))
  }
  if (linkIdsByType.training?.length) {
    const rows = await db.select({ id: trainingCourses.id, name: trainingCourses.name }).from(trainingCourses).where(inArray(trainingCourses.id, linkIdsByType.training))
    linkEnrichment.training = Object.fromEntries(rows.map((r) => [r.id, r.name]))
  }
  if (linkIdsByType.worker?.length) {
    // workers pertenece a worksites; usamos el id crudo y dejamos que la UI
    // muestre el id si no encuentra más info.
    linkEnrichment.worker = Object.fromEntries(linkIdsByType.worker.map((id) => [id, id]))
  }
  if (linkIdsByType.equipment?.length) {
    linkEnrichment.equipment = Object.fromEntries(linkIdsByType.equipment.map((id) => [id, id]))
  }
  if (linkIdsByType.epp_delivery?.length) {
    linkEnrichment.epp_delivery = Object.fromEntries(linkIdsByType.epp_delivery.map((id) => [id, id]))
  }

  // Hidratar tipos.
  const allTypeIds = bundle.versions.map((v) => v.documentId) // reusado; en realidad los types no se hidratan por versión
  void allTypeIds

  const canManage = can(session, "prevention:docs:manage")
  const canApprove = can(session, "prevention:docs:approve")
  const canArchive = can(session, "prevention:docs:archive")
  const canAck = can(session, "prevention:docs:ack")
  const canLink = can(session, "prevention:docs:link")

  return (
    <PageContainer width="workbench">
      <Breadcrumbs items={[
        { label: "Prevención", href: "/prevencion" },
        { label: "Biblioteca SST", href: "/prevencion/biblioteca" },
        { label: bundle.doc.title.slice(0, 48) },
      ]} />
      <PageHeader
        title={bundle.doc.title}
        description={`${bundle.doc.internalCode ?? "—"} · ${bundle.doc.categorySlug} · ${bundle.doc.status}`}
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
