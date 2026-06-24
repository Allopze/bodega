import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can, canAny } from "@/lib/auth/can"
import { getSectionAccess } from "@/lib/sst/checklist"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getEvaluation } from "@/lib/services/sst"
import { db } from "@/db"
import { sstResponses, sstScheduledFollowups, sstActionPlan, sstWeeklyEvaluations } from "@/db/schema/sst"
import { workers, worksites } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EvaluationDetail } from "./evaluation-detail"
import { getDefinition } from "@/lib/sst/definitions/index"
import { CARGO_KEYS } from "@/lib/sst/cargos"

export const metadata: Metadata = { title: "Evaluación SST" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function EvaluacionDetailPage({ params }: Props) {
  const { id } = await params

  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  // Acceso: prevención (sst:view) o roles acotados a una sección (p.ej. conductor_lider)
  if (!canAny(session, "sst:view", "sst:evaluate_acompanamiento")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all"  ? "all" :
    scope.mode === "some" ? scope.ids :
    []

  const evaluation = await getEvaluation(id, worksiteIds)
  if (!evaluation) redirect("/prevencion")

  // Load related data in parallel
  const [responses, followups, actionPlan, workerRow, worksiteRow, weeklyEvals] = await Promise.all([
    db.select().from(sstResponses).where(eq(sstResponses.evaluationId, id)),
    db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, id)),
    db.select().from(sstActionPlan).where(eq(sstActionPlan.evaluationId, id)),
    db.select({ firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
      .from(workers).where(eq(workers.id, evaluation.workerId)).limit(1),
    db.select({ name: worksites.name })
      .from(worksites).where(eq(worksites.id, evaluation.worksiteId)).limit(1),
    db.select().from(sstWeeklyEvaluations).where(eq(sstWeeklyEvaluations.evaluationId, id)).orderBy(sstWeeklyEvaluations.semana),
  ])

  const worker   = workerRow[0]
  const worksite = worksiteRow[0]
  const workerName   = worker   ? `${worker.firstName} ${worker.lastName}`.trim() : "—"
  const worksiteName = worksite ? worksite.name                                   : "—"
  const workerRut    = worker?.rut ?? ""

  // Get checklist definition
  const definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)

  // Build cargo labels
  const cargos = (evaluation.cargosJson as string[]) ?? []
  const cargoLabels = cargos.map((c) => (CARGO_KEYS as Record<string, string>)[c] ?? c)

  const canClose  = can(session, "sst:close")
  // sst:create covers both creating new evaluations and filling out existing drafts
  // (no separate sst:edit permission in this module)
  const canEdit   = can(session, "sst:create")
  const canManage = can(session, "sst:manage")
  // Quien no tiene sst:view (p.ej. conductor_lider) solo accede a sus secciones
  // por permiso: no ve acta / plan / seguimientos / cierre / compliance global.
  const canViewFullEvaluation = can(session, "sst:view")
  const sectionAccess = getSectionAccess(
    definition,
    session.user.permissions ?? [],
    { canCreate: canEdit, canViewFull: canViewFullEvaluation },
  )

  return (
    <PageContainer>
      <PageHeader
        title={`Evaluación ${evaluation.definicionCode}`}
        description={`${workerName} · ${worksiteName}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",        href: "/dashboard"  },
            { label: "Evaluaciones SST", href: "/prevencion" },
            { label: evaluation.definicionCode               },
          ]} />
        }
      />
      <EvaluationDetail
        evaluation={evaluation}
        definition={definition}
        responses={responses}
        followups={followups}
        actionPlan={actionPlan}
        workerName={workerName}
        workerRut={workerRut}
        worksiteName={worksiteName}
        cargoLabels={cargoLabels}
        canClose={canClose}
        canEdit={canEdit}
        canManage={canManage}
        canViewFullEvaluation={canViewFullEvaluation}
        sectionAccess={sectionAccess}
        weeklyEvals={weeklyEvals}
      />
    </PageContainer>
  )
}
