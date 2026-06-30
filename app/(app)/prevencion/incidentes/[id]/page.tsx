import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listIncidentActions } from "@/lib/services/prevention-incidents"
import { db } from "@/db"
import { preventionIncidents, preventionIncidentActions } from "@/db/schema"
import { workers } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { IncidentDetail } from "./incident-detail"

export const metadata: Metadata = { title: "Detalle de incidente" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function IncidentDetailPage({ params }: Props) {
  const { id } = await params

  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:incidents:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const [rows, actions] = await Promise.all([
    db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1),
    listIncidentActions(id, worksiteIds),
  ])
  const incident = rows[0]
  if (!incident) redirect("/prevencion/incidentes")

  // Faena scope guard.
  if (worksiteIds !== "all" && !worksiteIds.includes(incident.worksiteId)) {
    redirect("/forbidden")
  }

  const worker = incident.workerId
    ? (await db.select({ firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
        .from(workers).where(eq(workers.id, incident.workerId)).limit(1))[0] ?? null
    : null

  const canManage = can(session, "prevention:incidents:manage")
  const canClose = can(session, "prevention:incidents:close")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={incident.title}
        description={`${incident.type} · ${incident.occurredAt.slice(0, 10)} · ${incident.status}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Incidentes", href: "/prevencion/incidentes" },
            { label: incident.title.slice(0, 32) },
          ]} />
        }
      />
      <IncidentDetail
        incident={incident}
        actions={actions}
        worker={worker}
        canManage={canManage}
        canClose={canClose}
        hasPending={(actions as typeof preventionIncidentActions.$inferSelect[]).some((a) => a.status !== "cerrada" && a.status !== "cancelada")}
      />
    </PageContainer>
  )
}