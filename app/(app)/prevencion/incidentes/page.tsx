import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus, SlidersHorizontal } from "@phosphor-icons/react/dist/ssr"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { ExportLink } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getIncidentDashboardCounts, getIncidentStatusCounts, listIncidentWorksites, listPreventionIncidents } from "@/lib/services/prevention-incidents"
import { incidentLegacyQuickHref, parseIncidentCondition, parseIncidentStatusView } from "@/lib/prevention/incident-list-filters"
import { IncidentList } from "./incident-list"
import { PublicIncidentReportsPanel } from "./public-reports-panel"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"
import { Re20PwaRegister } from "@/components/pwa/re20-pwa-register"

export const metadata: Metadata = { title: "Incidentes y accidentes" }

const INDICATOR_LABELS: Record<string, string> = {
  accidentability: "accidentabilidad",
  frequency: "frecuencia",
  severity: "gravedad",
  pending: "pendientes",
}

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ worksiteId?: string; year?: string; monthFrom?: string; monthTo?: string; indicator?: string; status?: string; eventType?: string; quick?: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { redirect("/forbidden") }
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const query = await searchParams
  // El tablero publicó `?quick=open` cuando «Abiertos» era una tarjeta; hoy es una pestaña.
  const legacyHref = incidentLegacyQuickHref("/prevencion/incidentes", query)
  if (legacyHref) redirect(legacyHref)
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
  const eventType = query.eventType && query.eventType !== "all" ? query.eventType : undefined
  // Regla A5: cada dimensión se representa una vez. El estado son pestañas y las
  // tarjetas son condiciones que cruzan los estados; cada contador se calcula con
  // los filtros de la URL MENOS su propia dimensión, y la lista con todos, así que el
  // número de una pestaña o tarjeta es lo que la lista muestra al activarla.
  const shared = {
    worksiteId: query.worksiteId || undefined,
    year: Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : undefined,
    monthFrom: effectiveMonthFrom,
    monthTo: effectiveMonthTo,
    indicator,
    eventType,
  }
  const status = parseIncidentStatusView(query.status)
  const condition = parseIncidentCondition(query.quick)
  const [incidents, worksites, counts, statusCounts] = await Promise.all([
    listPreventionIncidents({ access, ...shared, status, condition }),
    listIncidentWorksites(access),
    getIncidentDashboardCounts(access, { ...shared, status }),
    getIncidentStatusCounts(access, { ...shared, condition }),
  ])
  const canReport = can(session, "prevention:incidents:report")
  const canExport = can(session, "prevention:incidents:export")
  // Triar el buzón es clasificar; abrir el incidente desde un reporte es además
  // reportarlo, con el permiso de siempre.
  const canTriage = can(session, "prevention:incidents:triage")
  const canConfigure = can(session, "prevention:incidents:configure_re20")

  return (
    <PageContainer>
      <Re20PwaRegister />
      <PageHeader
        title="Incidentes y accidentes"
        description="Eventos, plazos DIAT/DIEP, investigación, acciones CAPA y autorización de reinicio."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes" }]} />}
        actions={<div className="flex gap-2">
          {canReport && <Button asChild><Link href="/prevencion/incidentes/reportar"><Plus className="size-4" />Reportar</Link></Button>}
          {canExport && <ExportLink href="/api/prevencion/incidentes/export" />}
          {canConfigure && <Button asChild variant="secondary"><Link href="/prevencion/incidentes/configuracion"><SlidersHorizontal className="size-4" />Configurar RE-20</Link></Button>}
        </div>}
      />
      {/* INC-001: lo que llega por el canal público del trabajador, donde se tría. */}
      {(canReport || canTriage) && <PublicIncidentReportsPanel scope={access.scope} canTriage={canTriage} canConvert={canTriage} />}
      <IncidentList incidents={incidents} worksites={worksites} counts={counts} statusCounts={statusCounts} canReport={canReport} indicatorContext={indicatorLabel ? `Fuente del indicador de ${indicatorLabel} · ${effectiveMonthFrom ?? "—"}-${effectiveMonthTo ?? "—"}/${query.year ?? ""}` : undefined} />
      <PdtpScheduledActivityPanelServer connectorKey="incidents" />
    </PageContainer>
  )
}
