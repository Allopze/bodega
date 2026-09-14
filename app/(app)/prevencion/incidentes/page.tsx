import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { DownloadSimple, Plus } from "@phosphor-icons/react/dist/ssr"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getIncidentDashboardCounts, listIncidentWorksites, listPreventionIncidents } from "@/lib/services/prevention-incidents"
import { IncidentList } from "./incident-list"
import { PublicIncidentReportsPanel } from "./public-reports-panel"

export const metadata: Metadata = { title: "Incidentes y accidentes" }

const INDICATOR_LABELS: Record<string, string> = {
  accidentability: "accidentabilidad",
  frequency: "frecuencia",
  severity: "gravedad",
  pending: "pendientes",
}

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ worksiteId?: string; year?: string; monthFrom?: string; monthTo?: string; indicator?: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { redirect("/forbidden") }
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const query = await searchParams
  const indicator = ["accidentability", "frequency", "severity", "pending"].includes(query.indicator ?? "")
    ? query.indicator as "accidentability" | "frequency" | "severity" | "pending"
    : undefined
  const indicatorLabel = indicator ? INDICATOR_LABELS[indicator] ?? indicator : undefined
  const year = Number(query.year)
  const monthFromRaw = Number(query.monthFrom)
  const monthToRaw = Number(query.monthTo)
  const monthFrom = Number.isInteger(monthFromRaw) && monthFromRaw >= 1 && monthFromRaw <= 12 ? monthFromRaw : undefined
  const monthTo = Number.isInteger(monthToRaw) && monthToRaw >= 1 && monthToRaw <= 12 ? monthToRaw : undefined
  const effectiveMonthFrom = monthFrom && monthTo && monthFrom > monthTo ? undefined : monthFrom
  const effectiveMonthTo = monthFrom && monthTo && monthFrom > monthTo ? undefined : monthTo
  const [incidents, worksites, counts] = await Promise.all([
    listPreventionIncidents({
      access,
      worksiteId: query.worksiteId || undefined,
      year: Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : undefined,
      monthFrom: effectiveMonthFrom,
      monthTo: effectiveMonthTo,
      indicator,
    }),
    listIncidentWorksites(access),
    getIncidentDashboardCounts(access),
  ])
  const canReport = can(session, "prevention:incidents:report")
  const canExport = can(session, "prevention:incidents:export")

  return (
    <PageContainer>
      <PageHeader
        title="Incidentes y accidentes"
        description="Fuente canónica de eventos, plazos DIAT/DIEP, investigación, CAPA y autorización de reinicio."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes" }]} />}
        actions={<div className="flex gap-2">
          {canReport && <Button asChild><Link href="/prevencion/incidentes/reportar"><Plus className="size-4" />Reportar</Link></Button>}
          {canExport && <Button asChild variant="secondary"><a href="/api/prevencion/incidentes/export" download><DownloadSimple className="size-4" />Exportar Excel</a></Button>}
        </div>}
      />
      {/* INC-001: lo que llega por el canal público del trabajador, donde se tría. */}
      {canReport && <PublicIncidentReportsPanel scope={access.scope} />}
      <IncidentList incidents={incidents} worksites={worksites} counts={counts} canReport={canReport} indicatorContext={indicatorLabel ? `Fuente del indicador de ${indicatorLabel} · ${effectiveMonthFrom ?? "—"}-${effectiveMonthTo ?? "—"}/${query.year ?? ""}` : undefined} />
    </PageContainer>
  )
}
