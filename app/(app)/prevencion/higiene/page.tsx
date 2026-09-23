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
  listHygieneMeasurementSlots,
  listHygieneWorksites,
  listProtocolApplicabilities,
  listSurveillancePrograms,
} from "@/lib/services/prevention-hygiene"
import { resolveProgramActivationPeriod } from "@/lib/services/prevention-program-slots"
import { resolveProgramSlotYear } from "@/lib/prevention/program-slots-2026"
import { formatDate, todayInChile } from "@/lib/utils"
import { HygieneDashboard } from "./hygiene-dashboard"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

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
  // La casilla N°45 la resuelve quien registra la medición: es el permiso del hecho.
  const canRecordMeasurementSlots = session.user.permissions.includes("prevention:hygiene:measure")
  const slotYear = resolveProgramSlotYear(todayInChile().slice(0, 4))

  const [groups, programs, summary, agents, worksites, applicabilities, measurementSlots] = await Promise.all([
    listExposureGroups(access),
    listSurveillancePrograms(access),
    getAnonymizedExposureSummary(access),
    canManage ? listExposureAgents(access) : Promise.resolve([]),
    canManage ? listHygieneWorksites(access) : Promise.resolve([]),
    listProtocolApplicabilities(access),
    listHygieneMeasurementSlots(access, slotYear),
  ])
  // Desde cuándo exige el programa a cada faena: el checklist lo usa para no
  // pedir una casilla anterior a la incorporación de la faena al programa.
  const slotWorksiteIds = [...new Set(measurementSlots.map((row) => row.slot.worksiteId))]
  const activationPeriods = Object.fromEntries(await Promise.all(
    slotWorksiteIds.map(async (worksiteId) => [worksiteId, await resolveProgramActivationPeriod(worksiteId)] as const),
  ))
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
        measurementSlots={measurementSlots.map((row) => ({
          worksiteId: row.slot.worksiteId,
          id: row.slot.id,
          version: row.slot.version,
          slotKey: row.slot.slotKey,
          scheduledMonth: row.slot.scheduledMonth,
          scheduledWeek: row.slot.scheduledWeek,
          status: row.slot.status as "pending" | "completed" | "not_completed" | "not_applicable",
          observation: row.slot.observation,
          notApplicableReason: row.slot.notApplicableReason,
          fulfilledLabel: row.measuredOn
            ? `Cumplida por la medición${row.groupCode ? ` del GES ${row.groupCode}` : ""} del ${formatDate(row.measuredOn)}`
            : null,
        }))}
        slotYear={slotYear}
        activationPeriods={activationPeriods}
        canRecordMeasurementSlots={canRecordMeasurementSlots}
        today={todayInChile()}
        canManage={canManage}
      />
      <PdtpScheduledActivityPanelServer connectorKey="hygiene" />
    </PageContainer>
  )
}
