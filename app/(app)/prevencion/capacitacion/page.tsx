import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listCompetencyGaps,
  listMyPendingAcknowledgements,
  listTrainingCourses,
  listTrainingSessions,
} from "@/lib/services/prevention-training"
import { TrainingSessionList } from "./training-session-list"

export const metadata: Metadata = { title: "Capacitación y competencias" }

export default async function CapacitacionPage() {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const [sessions, courses, gaps, pendingAcks] = await Promise.all([
    listTrainingSessions(access),
    listTrainingCourses(access),
    listCompetencyGaps(access),
    listMyPendingAcknowledgements(access),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Capacitación y competencias"
        description="Sesiones, asistencia, evaluación y habilitación vigente por trabajador (DS 44 arts. 15 y 16)."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:training:export") ? (
            <Button asChild variant="secondary">
              <Link href="/api/prevencion/capacitacion/export">Exportar XLSX</Link>
            </Button>
          ) : undefined
        }
      />
      <TrainingSessionList
        sessions={sessions.map((row) => ({
          id: row.session.id,
          code: row.session.code,
          status: row.session.status,
          modality: row.session.modality,
          scheduledAt: row.session.scheduledAt,
          endedAt: row.session.endedAt,
          durationMinutes: row.session.durationMinutes,
          worksiteId: row.session.worksiteId,
          worksiteName: row.worksiteName,
          courseName: row.courseName,
          courseKind: row.courseKind,
          versionLabel: row.versionLabel,
          convenedCount: row.convenedCount,
          attendedCount: row.attendedCount,
          acknowledgedCount: row.acknowledgedCount,
        }))}
        courseCount={courses.length}
        blockingGapCount={gaps.filter((gap) => gap.enforcement === "blocking").length}
        pendingAcks={pendingAcks.map((item) => ({
          attendanceId: item.attendanceId,
          sessionCode: item.sessionCode,
          courseName: item.courseName,
          endedAt: item.endedAt,
        }))}
        canAck={session.user.permissions.includes("prevention:training:ack")}
      />
    </PageContainer>
  )
}
