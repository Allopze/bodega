import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  listCommitteeAssignees,
  listCommitteeMeetings,
  listCommittees,
  listCommitteeWorksites,
  listManagementReviews,
} from "@/lib/services/prevention-cphs"
import { listWorksiteOrganizations } from "@/lib/services/prevention-cphs-organization"
import { assessMeetingCadence, isMandateExpired } from "@/lib/prevention/cphs"
import { CommitteeList } from "./committee-list"
import { NewCommitteeDialog } from "./cphs-dialogs"
import { todayInChile } from "@/lib/utils"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "CPHS y gobernanza" }

export default async function CphsPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string | string[] }>
}) {
  let session
  try { session = await requirePermission("prevention:cphs:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:cphs:manage")
  const canReview = session.user.permissions.includes("prevention:governance:review")

  const [committees, meetings, worksites, reviews, assignees, organizations] = await Promise.all([
    listCommittees(access),
    listCommitteeMeetings(access),
    canManage || canReview ? listCommitteeWorksites(access) : Promise.resolve([]),
    canReview ? listManagementReviews(access) : Promise.resolve([]),
    canManage || canReview ? listCommitteeAssignees(access) : Promise.resolve([]),
    listWorksiteOrganizations(access),
  ])
  const cphsGaps = organizations.filter(
    (org) => org.compliance.required === "cphs" && !org.compliance.compliant,
  )
  const query = await searchParams
  const requestedWorksiteId = Array.isArray(query.faena) ? query.faena[0] : query.faena
  const initialWorksiteId = worksites.some((worksite) => worksite.id === requestedWorksiteId)
    ? requestedWorksiteId
    : undefined
  const today = todayInChile()
  const now = new Date().toISOString()

  return (
    <PageContainer>
      <PageHeader
        title="CPHS y gobernanza"
        description="Comités paritarios por centro de trabajo, sesiones con quórum, acuerdos derivados a CAPA y revisión por la dirección."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "CPHS" },
        ]} />}
      />
      {cphsGaps.length > 0 && (
        <Callout
          tone="warning"
          className="mb-4"
          title={cphsGaps.length === 1
            ? "1 faena supera los 25 trabajadores y no tiene Comité Paritario vigente"
            : `${cphsGaps.length} faenas superan los 25 trabajadores y no tienen Comité Paritario vigente`}
        >
          <ul className="space-y-1.5">
            {cphsGaps.map((gap) => (
              <li key={gap.worksiteId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{gap.worksiteName} · {gap.headcount} trabajadores</span>
                {canManage && worksites.length > 0 && (
                  <NewCommitteeDialog
                    worksites={worksites}
                    initialWorksiteId={gap.worksiteId}
                    trigger={
                      <Button size="sm" variant="secondary" aria-label={`Crear comité para ${gap.worksiteName}`}>
                        Crear comité
                      </Button>
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <CommitteeList
        committees={committees.map((row) => ({
          id: row.committee.id,
          name: row.committee.name,
          status: row.committee.status,
          worksiteName: row.worksiteName,
          constitutedOn: row.committee.constitutedOn,
          mandateEndsOn: row.committee.mandateEndsOn,
          mandateExpired: isMandateExpired(row.committee.mandateEndsOn, today),
          activeMembers: row.activeMembers,
          closedMeetings: row.closedMeetings,
          cadenceOverdue: assessMeetingCadence(row.lastMeetingAt, now).overdue,
        }))}
        meetings={meetings.map((row) => ({
          id: row.meeting.id,
          code: row.meeting.code,
          committeeName: row.committeeName,
          worksiteName: row.worksiteName,
          meetingType: row.meeting.meetingType,
          scheduledFor: row.meeting.scheduledFor,
          status: row.meeting.status,
          quorumReached: row.meeting.quorumReached,
          convened: row.convened,
          attended: row.attended,
          agreements: row.agreements,
        }))}
        reviews={reviews.map((row) => ({
          id: row.review.id,
          code: row.review.code,
          periodLabel: row.review.periodLabel,
          worksiteName: row.worksiteName,
          heldAt: row.review.heldAt,
          status: row.review.status,
          conclusions: row.review.conclusions,
          version: row.review.version,
        }))}
        worksites={worksites}
        assignees={assignees}
        initialWorksiteId={initialWorksiteId}
        canManage={canManage}
        canReview={canReview}
      />
      <PdtpScheduledActivityPanelServer connectorKey="cphs" />
    </PageContainer>
  )
}
