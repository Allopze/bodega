import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth, can, canAny } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEvaluationsGroupedByWorker } from "@/lib/services/sst"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { EvaluationList } from "./evaluation-list"

export const metadata: Metadata = { title: "Evaluaciones SST" }

export default async function PrevencionPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!canAny(session, "sst:view", "sst:evaluate_acompanamiento")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | 'all' =
    scope.mode === "all"  ? "all" :
    scope.mode === "some" ? scope.ids :
    []

  const workerGroups = await listEvaluationsGroupedByWorker(worksiteIds, 50, 0)
  const canCreate = can(session, "sst:create") || can(session, "sst:evaluate_acompanamiento")
  const canDelete = can(session, "sst:manage")

  return (
    <PageContainer>
      <PageHeader
        title="Evaluaciones SST"
        description="Registro de evaluaciones de seguridad y salud en el trabajo, agrupadas por trabajador."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Evaluaciones SST" },
          ]} />
        }
        headerActions={
          canCreate ? (
            <Button asChild>
              <Link href="/prevencion/nueva">Nueva Evaluación</Link>
            </Button>
          ) : undefined
        }
      />
      <EvaluationList workerGroups={workerGroups} canCreate={canCreate} canDelete={canDelete} />
    </PageContainer>
  )
}
