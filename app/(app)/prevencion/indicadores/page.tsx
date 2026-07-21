import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getCanonicalSafetyIndicatorYear } from "@/lib/services/prevention-indicadores"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { CanonicalIndicatorsDashboard } from "./canonical-indicators-dashboard"
import { ExportIndicadoresButton } from "./indicadores-export-button"

export const metadata: Metadata = { title: "Indicadores de accidentabilidad" }

type IndicadoresPageProps = {
  searchParams: Promise<{ year?: string }>
}

export default async function IndicadoresPage({ searchParams }: IndicadoresPageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:indicadores:view")) redirect("/forbidden")

  const canManage = can(session, "prevention:indicadores:manage")
  const hasClosePermission = can(session, "prevention:indicadores:close")
  const query = await searchParams
  const currentYear = new Date().getFullYear()
  const year = Number(query.year) || currentYear

  const canonicalView = await getCanonicalSafetyIndicatorYear(year, resolveWorksiteScope(session))

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
      <CanonicalIndicatorsDashboard
        view={canonicalView}
        currentYear={currentYear}
        canManage={canManage}
        canClose={hasClosePermission}
        currentUserId={session.user.id}
      />
    </PageContainer>
  )
}
