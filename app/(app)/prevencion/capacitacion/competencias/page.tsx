import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listCompetencyRequirements,
  listTrainingCourses,
  listWorkerCompetencies,
} from "@/lib/services/prevention-training"
import { CompetencyMatrix } from "./competency-matrix"

export const metadata: Metadata = { title: "Matriz de competencias" }

export default async function CompetenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ workerId?: string }>
}) {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const { workerId } = await searchParams
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const [competencies, requirements, courses] = await Promise.all([
    listWorkerCompetencies(access, workerId ? { workerId } : undefined),
    listCompetencyRequirements(access),
    listTrainingCourses(access),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Matriz de competencias"
        description="Habilitación vigente por persona y curso, con su origen, evidencia y vencimiento."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación", href: "/prevencion/capacitacion" },
          { label: "Competencias" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:training:export") ? (
            <Button asChild variant="secondary">
              <a href="/api/prevencion/capacitacion/export" download>Exportar Excel</a>
            </Button>
          ) : undefined
        }
      />
      <CompetencyMatrix
        filteredWorkerId={workerId ?? null}
        competencies={competencies.map((row) => ({
          id: row.competency.id,
          workerId: row.competency.workerId,
          workerName: `${row.workerLastName}, ${row.workerFirstName}`,
          workerPosition: row.workerPosition,
          worksiteName: row.worksiteName,
          courseName: row.courseName,
          courseKind: row.courseKind,
          status: row.competency.status,
          sourceType: row.competency.sourceType,
          grantedAt: row.competency.grantedAt,
          expiresAt: row.competency.expiresAt,
          externalIssuer: row.competency.externalIssuer,
          evidenceReference: row.competency.evidenceReference,
          revocationReason: row.competency.revocationReason,
        }))}
        requirements={requirements.map((row) => ({
          id: row.requirement.id,
          courseName: row.courseName,
          scopeType: row.requirement.scopeType,
          scopeValue: row.requirement.scopeValue,
          worksiteName: row.worksiteName,
          enforcement: row.requirement.enforcement,
          reason: row.requirement.reason,
          isActive: row.requirement.isActive,
        }))}
        courseCount={courses.length}
        canRevoke={session.user.permissions.includes("prevention:training:revoke")}
      />
    </PageContainer>
  )
}
