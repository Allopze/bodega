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
import { PlanDetail } from "./plan-detail"

export const metadata: Metadata = { title: "Plan de emergencia" }

export default async function PlanEmergenciaPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params

  let auth
  try { auth = await requirePermission("prevention:emergency:view") }
  catch { redirect("/forbidden") }

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

  const [allWorkers, assignees] = await Promise.all([
    canManage || canExecuteDrill ? listEmergencyWorkers(access) : Promise.resolve([]),
    canExecuteDrill ? listEmergencyAssignees(access) : Promise.resolve([]),
  ])
  const eligibleWorkers = allWorkers.filter((worker) => worker.worksiteId === detail.plan.worksiteId)

  return (
    <PageContainer>
      <PageHeader
        title={detail.plan.title}
        description={`${detail.plan.code} · ${detail.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
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
        contacts={detail.contacts}
        drills={detail.drills.map((drill) => ({
          id: drill.id,
          scenarioType: drill.scenarioType,
          scheduledFor: drill.scheduledFor,
          status: drill.status,
          outcome: drill.outcome,
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
      />
    </PageContainer>
  )
}
