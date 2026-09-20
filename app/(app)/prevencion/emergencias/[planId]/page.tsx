import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  getEmergencyPlanDetail,
  listEmergencyAssignees,
  listEmergencyWorkers,
} from "@/lib/services/prevention-emergency"
import { listLinkableResources } from "@/lib/services/worksite-inventory"
import { PlanDetail } from "./plan-detail"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { listPdtpAccreditationBindings } from "@/lib/services/pdtp/accreditation-bindings"

export const metadata: Metadata = { title: "Plan de emergencia" }

export default async function PlanEmergenciaPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params

  let auth
  try { auth = await requirePermission("prevention:emergency:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/emergencias")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await getEmergencyPlanDetail(planId, access)
  if (!detail) notFound()

  const canManage = auth.user.permissions.includes("prevention:emergency:manage")
  const canApprove = auth.user.permissions.includes("prevention:emergency:approve")
  const canExecuteDrill = auth.user.permissions.includes("prevention:emergency:drill_execute")

  // La faena del plan se pasa al servicio, no se filtra después: el tope de la
  // consulta se aplicaba antes del filtro y truncaba dotación arbitrariamente
  // (EMERGENCIAS-11).
  const [eligibleWorkers, assignees, linkableResources, catalogActivities, bindings] = await Promise.all([
    canManage || canExecuteDrill ? listEmergencyWorkers(access, detail.plan.worksiteId) : Promise.resolve([]),
    canExecuteDrill ? listEmergencyAssignees(access) : Promise.resolve([]),
    // Inventario de la faena que este plan todavía no declara. El padrón se
    // carga en Administración → Inventario de faena; el plan sólo elige.
    canManage ? listLinkableResources(detail.plan.worksiteId) : Promise.resolve([]),
    listCatalogActivities(),
    listPdtpAccreditationBindings({ sourceType: "emergencia", sourceIds: [detail.plan.id] }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title={detail.plan.title}
        description={`${detail.plan.code} · ${detail.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Emergencias", href: "/prevencion/emergencias" },
          { label: detail.plan.title },
        ]} />}
      />
      <PlanDetail
        plan={{
          id: detail.plan.id,
          code: detail.plan.code,
          title: detail.plan.title,
          status: detail.plan.status,
          description: detail.plan.description,
          createdByUserId: detail.plan.createdByUserId,
          version: detail.plan.version,
          pdtpActivityNumbers: detail.plan.pdtpActivityNumbers ?? [],
        }}
        worksiteName={detail.worksiteName}
        readiness={detail.readiness}
        scenarios={detail.scenarios}
        roles={detail.roles.map((role) => ({
          id: role.id,
          roleName: role.roleName,
          assigneeName: role.assigneeName,
          backupName: role.backupName,
        }))}
        resources={detail.resources}
        linkableResources={linkableResources}
        contacts={detail.contacts}
        drills={detail.drills.map((drill) => ({
          id: drill.id,
          scenarioType: drill.scenarioType,
          scheduledFor: drill.scheduledFor,
          status: drill.status,
          outcome: drill.outcome,
          activeEvidenceCount: drill.activeEvidenceCount,
          version: drill.version,
        }))}
        eligibleWorkers={eligibleWorkers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
        }))}
        assignees={assignees}
        currentUserId={auth.user.id}
        canManage={canManage}
        canApprove={canApprove}
        canExecuteDrill={canExecuteDrill}
        catalogActivities={catalogActivities.map((activity) => ({ id: activity.id, code: activity.code, title: activity.title, description: activity.description, status: activity.status as "draft" | "active" | "retired" }))}
        catalogActivityIds={bindings.filter((binding) => binding.eventType === "complete_drill" && binding.isActive).map((binding) => binding.catalogActivityId)}
      />
    </PageContainer>
  )
}
