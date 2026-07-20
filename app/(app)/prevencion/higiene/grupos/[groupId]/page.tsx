import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listGroupMeasurements, listHygieneWorkers } from "@/lib/services/prevention-hygiene"
import { GroupDetail } from "./group-detail"

export const metadata: Metadata = { title: "Grupo de exposición" }

export default async function GrupoPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params

  let auth
  try { auth = await requirePermission("prevention:hygiene:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await listGroupMeasurements(groupId, access)
  if (!detail) notFound()

  const canManage = auth.user.permissions.includes("prevention:hygiene:manage")
  const canMeasure = auth.user.permissions.includes("prevention:hygiene:measure")
  const allWorkers = canManage ? await listHygieneWorkers(access) : []
  const eligibleWorkers = allWorkers.filter((worker) => worker.worksiteId === detail.group.worksiteId)

  return (
    <PageContainer>
      <PageHeader
        title={detail.group.name}
        description={`${detail.worksiteName} · ${detail.agent.name}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Higiene", href: "/prevencion/higiene" },
          { label: detail.group.name },
        ]} />}
      />
      <GroupDetail
        group={{
          id: detail.group.id,
          code: detail.group.code,
          name: detail.group.name,
          processDescription: detail.group.processDescription,
          surveillanceRequired: detail.group.surveillanceRequired,
          surveillanceReason: detail.group.surveillanceReason,
          isActive: detail.group.isActive,
        }}
        worksiteName={detail.worksiteName}
        agent={{
          id: detail.agent.id,
          name: detail.agent.name,
          agentType: detail.agent.agentType,
          unit: detail.agent.unit,
          permissibleLimit: detail.agent.permissibleLimit,
          actionLevelFactor: detail.agent.actionLevelFactor,
          limitBasis: detail.agent.limitBasis,
        }}
        members={detail.members.map((member) => ({
          id: member.id,
          workerName: member.workerName,
          workerPosition: member.workerPosition,
          joinedOn: member.joinedOn,
          leftOn: member.leftOn,
        }))}
        measurements={detail.measurements.map((item) => ({
          id: item.id,
          measuredOn: item.measuredOn,
          value: item.value,
          unit: item.unit,
          permissibleLimitSnapshot: item.permissibleLimitSnapshot,
          actionLevelSnapshot: item.actionLevelSnapshot,
          outcome: item.outcome,
          method: item.method,
          laboratoryName: item.laboratoryName,
          equipmentTag: item.equipmentTag,
        }))}
        eligibleWorkers={eligibleWorkers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
        }))}
        canManage={canManage}
        canMeasure={canMeasure}
      />
    </PageContainer>
  )
}
