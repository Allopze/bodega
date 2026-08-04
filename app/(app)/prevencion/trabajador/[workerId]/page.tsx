import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { sstEvaluations, sstWeeklyEvaluations } from "@/db/schema/sst"
import { workers, worksites } from "@/db/schema/worksites"
import { eq, desc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { resolveEvaluatorRole } from "@/lib/sst/resolve-evaluator-role"
import { WorkerEvaluations } from "./worker-evaluations"
import { evaluationsForVisit, listOpenEvaluationVisits } from "./visit-context"

export const metadata: Metadata = { title: "Evaluaciones del Trabajador - SST" }

interface Props {
  params: Promise<{ workerId: string }>
}

export default async function WorkerEvaluationsPage({ params }: Props) {
  const { workerId } = await params

  let session
  try {
    session = await requireAuth()
  } catch {
    redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/trabajador")}`)
  }

  if (!canAny(session, "sst:view", "sst:evaluate_acompanamiento")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/trabajador")}`)
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" :
    scope.mode === "some" ? scope.ids :
    []

  // Fetch worker details
  const [worker] = await db
    .select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      rut: workers.rut,
      position: workers.position,
      worksiteId: workers.worksiteId,
      worksiteName: worksites.name,
    })
    .from(workers)
    .leftJoin(worksites, eq(workers.worksiteId, worksites.id))
    .where(eq(workers.id, workerId))
    .limit(1)

  if (!worker) {
    redirect("/prevencion")
  }

  // Verify worksite scope access
  if (worksiteIds !== "all" && !worksiteIds.includes(worker.worksiteId)) {
    redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/trabajador")}`)
  }

  // Fetch all evaluations for this worker
  const evaluations = await db
    .select()
    .from(sstEvaluations)
    .where(eq(sstEvaluations.workerId, workerId))
    .orderBy(desc(sstEvaluations.createdAt))

  const openVisits = listOpenEvaluationVisits(evaluations, worker.worksiteId)
  // Con una sola visita en borrador se muestra como el caso de trabajo actual.
  // Con varias, el usuario la elige antes de añadir otra participación.
  const activeVisitId = openVisits.length === 1 ? openVisits.at(0)?.id ?? null : null
  const currentVisitEvaluations = evaluationsForVisit(evaluations, activeVisitId)

  // Fetch weekly evaluations only for the active visit; older visits are history.
  const condEval = currentVisitEvaluations.find(e => e.evaluatorRole === 'conductor_lider')
  let weeklyEvals: typeof sstWeeklyEvaluations.$inferSelect[] = []
  if (condEval) {
    weeklyEvals = await db
      .select()
      .from(sstWeeklyEvaluations)
      .where(eq(sstWeeklyEvaluations.evaluationId, condEval.id))
      .orderBy(sstWeeklyEvaluations.semana)
  }

  const workerName = `${worker.firstName} ${worker.lastName}`.trim()

  const permissions = {
    canCreate: can(session, "sst:create"),
    canEvaluateAcompanamiento: can(session, "sst:evaluate_acompanamiento"),
    canDelete: can(session, "sst:manage"),
  }

  // Determine current user's evaluator role
  const userPermissions = session.user.permissions ?? []
  const userRoles = session.user.roles ?? []
  const userEvaluatorRole = resolveEvaluatorRole({
    permissions: userPermissions,
    roles: userRoles as string[],
  })

  return (
    <PageContainer>
      <PageHeader
        title={`Evaluaciones de ${workerName}`}
        description={`RUT: ${worker.rut || "—"} · Faena: ${worker.worksiteName || "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Evaluaciones SST", href: "/prevencion" },
            { label: workerName },
          ]} />
        }
      />
      <WorkerEvaluations
        worker={worker}
        evaluations={currentVisitEvaluations}
        weeklyEvals={weeklyEvals}
        permissions={permissions}
        userEvaluatorRole={userEvaluatorRole}
        openVisits={openVisits}
      />
    </PageContainer>
  )
}
