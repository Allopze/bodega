import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEvaluations } from "@/lib/services/sst"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { EvaluationList } from "./evaluation-list"

export const metadata: Metadata = { title: "Evaluaciones SST" }

export default async function PrevencionPage() {
  let session
  try { session = await requirePermission("sst:view") }
  catch { redirect("/forbidden") }

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | 'all' =
    scope.mode === "all"  ? "all" :
    scope.mode === "some" ? scope.ids :
    []

  const evaluations = await listEvaluations({ worksiteIds }, 50, 0)
  const canCreate = can(session, "sst:create")

  return (
    <PageContainer>
      <PageHeader
        title="Evaluaciones SST"
        description="Registro de evaluaciones de seguridad y salud en el trabajo."
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
      <EvaluationList evaluations={evaluations} canCreate={canCreate} />
    </PageContainer>
  )
}
