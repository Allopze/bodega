import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  getCommitteeStatus,
  listCommissions,
  listCommitteeAssignees,
  listCommitteeMeetings,
  listCommitteeWorkers,
} from "@/lib/services/prevention-cphs"
import { listDocumentsForEntity } from "@/lib/services/prevention-documents/links"
import { CommitteeDetail } from "./committee-detail"
import { CommitteeDocuments } from "./committee-documents"

export const metadata: Metadata = { title: "Comité paritario" }

export default async function ComitePage({ params }: { params: Promise<{ committeeId: string }> }) {
  const { committeeId } = await params

  let auth
  try { auth = await requirePermission("prevention:cphs:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/cphs")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const status = await getCommitteeStatus(committeeId, access)
  if (!status) notFound()

  const canManage = auth.user.permissions.includes("prevention:cphs:manage")
  const [allMeetings, allWorkers, assignees, documents, commissions] = await Promise.all([
    listCommitteeMeetings(access),
    canManage ? listCommitteeWorkers(access) : Promise.resolve([]),
    canManage ? listCommitteeAssignees(access) : Promise.resolve([]),
    auth.user.permissions.includes("prevention:docs:view")
      ? listDocumentsForEntity("committee", committeeId)
      : Promise.resolve([]),
    listCommissions(committeeId, access),
  ])

  const meetings = allMeetings.filter((row) => row.meeting.committeeId === committeeId)
  const eligibleWorkers = allWorkers.filter((worker) => worker.worksiteId === status.committee.worksiteId)

  return (
    <PageContainer>
      <PageHeader
        title={status.committee.name}
        description={status.worksiteName}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/prevencion/cphs/${committeeId}/programa`}>Programa de trabajo</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/prevencion/cphs/${committeeId}/certificacion`}>Certificación Mutual</Link>
            </Button>
          </div>
        }
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
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
          guests: row.guests,
          agreements: row.agreements,
          agendaSentAt: row.meeting.agendaSentAt,
          sentToManagementAt: row.meeting.sentToManagementAt,
          version: row.meeting.version,
        }))}
        eligibleWorkers={eligibleWorkers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
        }))}
        assignees={assignees}
        commissions={commissions.map((row) => ({
          id: row.commission.id,
          name: row.commission.name,
          purpose: row.commission.purpose,
          memberCount: row.memberCount,
        }))}
        canManage={canManage}
      />
      {auth.user.permissions.includes("prevention:docs:view") && (
        <CommitteeDocuments documents={documents.map((row) => ({
          linkId: row.linkId,
          documentId: row.documentId,
          title: row.title,
          internalCode: row.internalCode,
          status: row.status,
          notes: row.notes,
        }))} />
      )}
    </PageContainer>
  )
}
