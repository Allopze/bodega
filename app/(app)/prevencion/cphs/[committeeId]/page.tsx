import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  getCommitteeStatus,
  listCommitteeAssignees,
  listCommitteeMeetings,
  listCommitteeWorkers,
} from "@/lib/services/prevention-cphs"
import { CommitteeDetail } from "./committee-detail"

export const metadata: Metadata = { title: "Comité paritario" }

export default async function ComitePage({ params }: { params: Promise<{ committeeId: string }> }) {
  const { committeeId } = await params

  let auth
  try { auth = await requirePermission("prevention:cphs:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const status = await getCommitteeStatus(committeeId, access)
  if (!status) notFound()

  const canManage = auth.user.permissions.includes("prevention:cphs:manage")
  const [allMeetings, allWorkers, assignees] = await Promise.all([
    listCommitteeMeetings(access),
    canManage ? listCommitteeWorkers(access) : Promise.resolve([]),
    canManage ? listCommitteeAssignees(access) : Promise.resolve([]),
  ])

  const meetings = allMeetings.filter((row) => row.meeting.committeeId === committeeId)
  const eligibleWorkers = allWorkers.filter((worker) => worker.worksiteId === status.committee.worksiteId)

  return (
    <PageContainer>
      <PageHeader
        title={status.committee.name}
        description={status.worksiteName}
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "CPHS", href: "/prevencion/cphs" },
          { label: status.committee.name },
        ]} />}
      />
      <CommitteeDetail
        committee={{
          id: status.committee.id,
          name: status.committee.name,
          status: status.committee.status,
          constitutedOn: status.committee.constitutedOn,
          mandateEndsOn: status.committee.mandateEndsOn,
          meetingDayOfMonth: status.committee.meetingDayOfMonth,
          version: status.committee.version,
        }}
        worksiteName={status.worksiteName}
        parity={status.parity}
        mandateExpired={status.mandateExpired}
        cadence={status.cadence}
        members={status.members.map((member) => ({
          id: member.id,
          workerName: member.workerName,
          representation: member.representation,
          seat: member.seat,
          role: member.role,
          status: member.status,
          hasFuero: member.hasFuero,
          electedOn: member.electedOn,
          termEndsOn: member.termEndsOn,
        }))}
        meetings={meetings.map((row) => ({
          id: row.meeting.id,
          code: row.meeting.code,
          meetingType: row.meeting.meetingType,
          scheduledFor: row.meeting.scheduledFor,
          agenda: row.meeting.agenda,
          status: row.meeting.status,
          quorumReached: row.meeting.quorumReached,
          convened: row.convened,
          attended: row.attended,
          agreements: row.agreements,
          version: row.meeting.version,
        }))}
        eligibleWorkers={eligibleWorkers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
        }))}
        assignees={assignees}
        canManage={canManage}
      />
    </PageContainer>
  )
}
