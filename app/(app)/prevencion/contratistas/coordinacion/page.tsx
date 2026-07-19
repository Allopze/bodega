import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listCoordinationMeetings } from "@/lib/services/prevention-contractors"
import { CoordinationMeetingList } from "./coordination-meeting-list"

export const metadata: Metadata = { title: "Coordinación DS 76" }

export default async function CoordinacionPage() {
  let session
  try { session = await requirePermission("prevention:contractors:view") }
  catch { redirect("/forbidden") }

  const meetings = await listCoordinationMeetings({
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })

  return (
    <PageContainer>
      <PageHeader
        title="Coordinación DS 76"
        description="Reuniones de coordinación preventiva con empresas contratistas, intercambio de riesgos y acuerdos derivados a CAPA."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Contratistas", href: "/prevencion/contratistas" },
          { label: "Coordinación" },
        ]} />}
      />
      <CoordinationMeetingList
        meetings={meetings.map((row) => ({
          id: row.meeting.id,
          code: row.meeting.code,
          heldAt: row.meeting.heldAt,
          subject: row.meeting.subject,
          status: row.meeting.status,
          worksiteName: row.worksiteName,
          riskExchangeSummary: row.meeting.riskExchangeSummary,
          convenedCount: row.convenedCount,
          attendedCount: row.attendedCount,
        }))}
      />
    </PageContainer>
  )
}
