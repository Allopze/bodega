import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getTrainingSessionDetail } from "@/lib/services/prevention-training"
import { SessionDetail } from "./session-detail"

export const metadata: Metadata = { title: "Sesión de capacitación" }

export default async function SesionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params

  let auth
  try { auth = await requirePermission("prevention:training:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/capacitacion")}`) }

  const detail = await getTrainingSessionDetail(sessionId, {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  })
  if (!detail) notFound()

  return (
    <PageContainer>
      <PageHeader
        title={`${detail.courseName} · ${detail.session.code}`}
        description={`Versión ${detail.versionLabel} · ${detail.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación", href: "/prevencion/capacitacion" },
          { label: detail.session.code },
        ]} />}
      />
      <SessionDetail
        session={{
          id: detail.session.id,
          code: detail.session.code,
          status: detail.session.status,
          modality: detail.session.modality,
          scheduledAt: detail.session.scheduledAt,
          startedAt: detail.session.startedAt,
          endedAt: detail.session.endedAt,
          durationMinutes: detail.session.durationMinutes,
          location: detail.session.location,
          instructorExternalName: detail.session.instructorExternalName,
          instructorCompetencyEvidence: detail.session.instructorCompetencyEvidence,
          cancellationReason: detail.session.cancellationReason,
          version: detail.session.version,
        }}
        course={{
          name: detail.courseName,
          kind: detail.courseKind,
          minimumDurationMinutes: detail.minimumDurationMinutes,
          validityMonths: detail.validityMonths,
          versionLabel: detail.versionLabel,
          assessmentType: detail.assessmentType,
          passingScore: detail.passingScore,
        }}
        attendance={detail.attendance.map((row) => ({
          id: row.attendance.id,
          workerId: row.attendance.workerId,
          workerName: `${row.workerLastName}, ${row.workerFirstName}`,
          workerPosition: row.workerPosition,
          status: row.attendance.status,
          attendanceMinutes: row.attendance.attendanceMinutes,
          assessmentScore: row.attendance.assessmentScore,
          assessmentResult: row.attendance.assessmentResult,
          excuseReason: row.attendance.excuseReason,
          acknowledgedAt: row.attendance.acknowledgedAt,
        }))}
        canDeliver={auth.user.permissions.includes("prevention:training:deliver")}
        canManage={auth.user.permissions.includes("prevention:training:manage")}
      />
    </PageContainer>
  )
}
