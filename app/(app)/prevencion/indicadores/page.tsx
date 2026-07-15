import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getSafetyIndicators, listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { IndicadoresDashboard } from "./indicadores-dashboard"
import { ExportIndicadoresButton } from "./indicadores-export-button"

export const metadata: Metadata = { title: "Indicadores de accidentabilidad" }

type IndicadoresPageProps = {
  searchParams: Promise<{ year?: string }>
}

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function IndicadoresPage({ searchParams }: IndicadoresPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:indicadores:view")) redirect("/forbidden")

  const canManage = can(session, "prevention:indicadores:manage")
  const query = await searchParams
  const currentYear = new Date().getFullYear()
  const year = Number(query.year) || currentYear

  const scope = scopeToIds(resolveWorksiteScope(session))
  const [worksites, indicatorRows] = await Promise.all([
    listVisibleWorksites(scope),
    getSafetyIndicators(year, scope),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Indicadores de accidentabilidad"
        description="Registro mensual de indicadores de seguridad y salud ocupacional por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Indicadores de accidentabilidad" },
          ]} />
        }
        actions={<ExportIndicadoresButton year={year} />}
      />
      <IndicadoresDashboard
        worksites={worksites}
        indicatorRows={indicatorRows}
        year={year}
        currentYear={currentYear}
        canManage={canManage}
      />
    </PageContainer>
  )
}
