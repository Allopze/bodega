import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listExpiredTrainings,
  listTrainingCourses,
} from "@/lib/services/prevention-training"
import { db } from "@/db"
import { workers, trainingCourses } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { TrainingList } from "./training-list"

export const metadata: Metadata = { title: "Capacitaciones" }

export default async function CapacitacionesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:training:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const today = new Date().toISOString().slice(0, 10)
  const [expired, courses] = await Promise.all([
    listExpiredTrainings(worksiteIds, today),
    listTrainingCourses(),
  ])

  const workerIds = Array.from(new Set(expired.map((e) => e.workerId)))
  const courseIds = Array.from(new Set(expired.map((e) => e.courseId)))

  const [workerRows, courseRows] = await Promise.all([
    workerIds.length
      ? db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
          .from(workers).where(inArray(workers.id, workerIds))
      : Promise.resolve([] as { id: string; firstName: string; lastName: string; rut: string | null }[]),
    courseIds.length
      ? db.select({ id: trainingCourses.id, code: trainingCourses.code, name: trainingCourses.name })
          .from(trainingCourses).where(inArray(trainingCourses.id, courseIds))
      : Promise.resolve([] as { id: string; code: string; name: string }[]),
  ])

  const workerMap = Object.fromEntries(workerRows.map((w) => [w.id, w]))
  const courseMap = Object.fromEntries(courseRows.map((c) => [c.id, c]))

  const enriched = expired.map((e) => ({
    ...e,
    worker: workerMap[e.workerId] ?? null,
    course: courseMap[e.courseId] ?? null,
  }))

  const canManage = can(session, "prevention:training:manage")

  return (
    <PageContainer>
      <PageHeader
        title="Capacitaciones"
        description="Cursos, asignaciones, vencimientos y competencias vencidas por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Capacitaciones" },
          ]} />
        }
        actions={<PreventionExportButton href="/api/prevencion/capacitaciones/export" label="Exportar Capacitaciones" />}
      />
      <TrainingList
        expired={enriched}
        courses={courses}
        canManage={canManage}
      />
    </PageContainer>
  )
}