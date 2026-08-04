import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listAllCourseVersions,
  listCompetencyGaps,
  listMyPendingAcknowledgements,
  listTrainingCourses,
  listTrainingSessions,
  listTrainingWorkers,
  listTrainingWorksites,
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
  const canManage = session.user.permissions.includes("prevention:training:manage")
  const [sessions, courses, gaps, pendingAcks, versions, worksites, workers] = await Promise.all([
    listTrainingSessions(access),
    listTrainingCourses(access),
    listCompetencyGaps(access),
    listMyPendingAcknowledgements(access),
    // La convocatoria sólo la necesita quien puede programar: para el resto son
    // dos consultas sobre toda la dotación que nadie va a mirar.
    canManage ? listAllCourseVersions(access) : Promise.resolve([]),
    canManage ? listTrainingWorksites(access) : Promise.resolve([]),
    canManage ? listTrainingWorkers(access) : Promise.resolve([]),
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
              <a href="/api/prevencion/capacitacion/export" download>Exportar Excel</a>
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
        canManage={canManage}
        publishedVersions={versions
          .filter((row) => row.version.status === "published")
          .map((row) => ({
            id: row.version.id,
            courseName: row.courseName,
            versionLabel: row.version.versionLabel,
            modality: row.version.modality,
          }))}
        worksites={worksites}
        workers={workers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
          worksiteId: worker.worksiteId,
        }))}
      />
    </PageContainer>
  )
}
