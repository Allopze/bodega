import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCommitteeStatus, listCommitteeMeetings } from "@/lib/services/prevention-cphs"
import { getProgramStatus, listProgramsForCommittee } from "@/lib/services/prevention-cphs-program"
import { ProgramHeaderActions, ProgramPanel } from "./program-panel"

export const metadata: Metadata = { title: "Programa de trabajo del comité" }

export default async function ProgramaComitePage({ params, searchParams }: {
  params: Promise<{ committeeId: string }>
  searchParams: Promise<{ programa?: string }>
}) {
  const { committeeId } = await params
  const { programa } = await searchParams

  let session
  try { session = await requirePermission("prevention:cphs:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/cphs")}`) }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }

  const status = await getCommitteeStatus(committeeId, access)
  if (!status) notFound()

  const [programs, allMeetings] = await Promise.all([
    listProgramsForCommittee(committeeId, access),
    listCommitteeMeetings(access),
  ])
  // Sin selección explícita manda el más reciente, que es el que se trabaja.
  const selectedId = programa && programs.some((row) => row.id === programa) ? programa : programs[0]?.id
  const selected = selectedId ? await getProgramStatus(selectedId, access) : null

  const canManage = session.user.permissions.includes("prevention:cphs:manage")
  const activeMembers = status.members
    .filter((member) => member.status === "active")
    .map((member) => ({ id: member.id, name: member.workerName }))
  // Sólo las sesiones cerradas acreditan haber revisado una actividad.
  const meetings = allMeetings
    .filter((row) => row.meeting.committeeId === committeeId && row.meeting.status === "closed")
    .map((row) => ({ id: row.meeting.id, code: row.meeting.code, scheduledFor: row.meeting.scheduledFor }))
  const committeeActive = status.committee.status === "active" && !status.mandateExpired
  const selectedView = selected && {
    id: selected.program.id,
    year: selected.program.year,
    status: selected.program.status,
    version: selected.program.version,
    summary: selected.summary,
    asOf: selected.asOf,
    activities: selected.activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description,
      plannedMonth: activity.plannedMonth,
      dueOn: activity.dueOn,
      status: activity.status,
      riskTopic: activity.riskTopic,
      responsibleName: activity.responsibleName,
      commissionLabel: activity.commissionLabel,
      completionNote: activity.completionNote,
      reviewedInMeetingId: activity.reviewedInMeetingId,
      version: activity.version,
    })),
  }

  return (
    <PageContainer>
      <PageHeader
        title="Programa de trabajo"
        description={`${status.committee.name} · ${status.worksiteName}`}
        actions={canManage ? <ProgramHeaderActions
          committeeId={committeeId}
          committeeActive={committeeActive}
          selected={selectedView}
          members={activeMembers}
        /> : undefined}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "CPHS", href: "/prevencion/cphs" },
          { label: status.committee.name, href: `/prevencion/cphs/${committeeId}` },
          { label: "Programa" },
        ]} />}
      />
      <ProgramPanel
        committeeId={committeeId}
        committeeActive={committeeActive}
        programs={programs.map((row) => ({ id: row.id, year: row.year, status: row.status, version: row.version }))}
        selected={selectedView}
        members={activeMembers}
        meetings={meetings}
        canManage={canManage}
      />
    </PageContainer>
  )
}
