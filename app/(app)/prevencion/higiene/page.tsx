import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  getAnonymizedExposureSummary,
  listExposureAgents,
  listExposureGroups,
  listHygieneWorksites,
  listProtocolApplicabilities,
  listSurveillancePrograms,
} from "@/lib/services/prevention-hygiene"
import { todayInChile } from "@/lib/utils"
import { HygieneDashboard } from "./hygiene-dashboard"

export const metadata: Metadata = { title: "Higiene y vigilancia" }

export default async function HigienePage() {
  let session
  try { session = await requirePermission("prevention:hygiene:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:hygiene:manage")

  const [groups, programs, summary, agents, worksites, applicabilities] = await Promise.all([
    listExposureGroups(access),
    listSurveillancePrograms(access),
    getAnonymizedExposureSummary(access),
    canManage ? listExposureAgents(access) : Promise.resolve([]),
    canManage ? listHygieneWorksites(access) : Promise.resolve([]),
    listProtocolApplicabilities(access),
  ])
  // La pestaña de protocolos necesita todas las faenas visibles, no sólo las
  // gestionables: quien sólo mira igual tiene que poder revisar la cobertura.
  const protocolWorksites = [...new Map(
    [...worksites.map((item) => [item.id, item.name] as const),
     ...applicabilities.map((row) => [row.applicability.worksiteId, row.worksiteName] as const)],
  ).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es-CL"))

  return (
    <PageContainer>
      <PageHeader
        title="Higiene y vigilancia"
        description="Agentes con límite permisible, grupos de exposición similar, mediciones y cobertura de vigilancia ocupacional."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Higiene" },
        ]} />}
      />
      <HygieneDashboard
        groups={groups.map((row) => ({
          id: row.group.id,
          code: row.group.code,
          name: row.group.name,
          worksiteName: row.worksiteName,
          agentName: row.agentName,
          agentType: row.agentType,
          agentUnit: row.agentUnit,
          surveillanceRequired: row.group.surveillanceRequired,
          surveillanceReason: row.group.surveillanceReason,
          memberCount: row.memberCount,
          measurementCount: row.measurementCount,
          latestOutcome: row.latestOutcome,
        }))}
        programs={programs.map((row) => ({
          id: row.program.id,
          code: row.program.code,
          name: row.program.name,
          protocol: row.program.protocol,
          worksiteName: row.worksiteName,
          status: row.program.status,
          periodicityMonths: row.program.periodicityMonths,
          enrolled: row.enrolled,
          attended: row.attended,
          overdue: row.overdue,
        }))}
        summary={summary}
        agents={agents.map((item) => ({ id: item.id, code: item.code, name: item.name, unit: item.unit }))}
        worksites={worksites}
        protocolWorksites={protocolWorksites}
        applicabilities={applicabilities.map((row) => ({
          worksiteId: row.applicability.worksiteId,
          worksiteName: row.worksiteName,
          protocolCode: row.applicability.protocolCode,
          status: row.applicability.status,
          justification: row.applicability.justification,
          nextAssessmentOn: row.applicability.nextAssessmentOn,
          version: row.applicability.version,
        }))}
        today={todayInChile()}
        canManage={canManage}
      />
    </PageContainer>
  )
}
