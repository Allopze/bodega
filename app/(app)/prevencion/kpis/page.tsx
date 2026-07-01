import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { getIncidentFrequencyRate } from "@/lib/services/prevention-kpis"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { KpisPanel } from "./kpis-panel"

export const metadata: Metadata = { title: "Indicadores preventivos" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function KpisPage({ searchParams }: { searchParams: Promise<{ anio?: string; faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:kpis:view")) redirect("/forbidden")

  const query = await searchParams
  const year = Number(query.anio) || 2026
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWorksiteId = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  const [indicators, rate] = await Promise.all([
    getPdtpComplianceIndicators(year, selectedWorksiteId),
    selectedWorksiteId ? getIncidentFrequencyRate(selectedWorksiteId, year, scope) : Promise.resolve(null),
  ])

  return (
    <PageContainer>
      <KpisPanel
        year={year}
        worksiteId={selectedWorksiteId}
        worksites={worksites}
        indicators={indicators}
        rate={rate}
        canManage={can(session, "prevention:kpis:manage")}
      />
    </PageContainer>
  )
}
