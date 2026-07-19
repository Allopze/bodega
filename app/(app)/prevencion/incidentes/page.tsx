import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { DownloadSimple, FileXls, Plus, UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getIncidentDashboardCounts, listIncidentWorksites, listPreventionIncidents } from "@/lib/services/prevention-incidents"
import { IncidentList } from "./incident-list"

export const metadata: Metadata = { title: "Incidentes y denuncias" }

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ worksiteId?: string; year?: string; monthFrom?: string; monthTo?: string; indicator?: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { redirect("/forbidden") }
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const query = await searchParams
  const indicator = ["accidentability", "frequency", "severity", "pending"].includes(query.indicator ?? "")
    ? query.indicator as "accidentability" | "frequency" | "severity" | "pending"
    : undefined
  const year = Number(query.year)
  const monthFrom = Number(query.monthFrom)
  const monthTo = Number(query.monthTo)
  const [incidents, worksites, counts] = await Promise.all([
    listPreventionIncidents({
      access,
      worksiteId: query.worksiteId || undefined,
      year: Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : undefined,
      monthFrom: Number.isInteger(monthFrom) && monthFrom >= 1 && monthFrom <= 12 ? monthFrom : undefined,
      monthTo: Number.isInteger(monthTo) && monthTo >= 1 && monthTo <= 12 ? monthTo : undefined,
      indicator,
    }),
    listIncidentWorksites(access),
    getIncidentDashboardCounts(access),
  ])
  const canReport = can(session, "prevention:incidents:report")
  const canImport = can(session, "prevention:incidents:triage")
  const canExport = can(session, "prevention:incidents:export")

  return (
    <PageContainer>
      <PageHeader
        title="Incidentes y denuncias"
        description="Fuente canónica de eventos, plazos DIAT/DIEP, investigación, CAPA y autorización de reinicio."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención" }, { label: "Incidentes" }]} />}
        actions={<div className="flex gap-2">
          {canReport && <Button asChild><Link href="/prevencion/incidentes/reportar"><Plus className="size-4" />Reportar</Link></Button>}
          {(canImport || canExport) && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="secondary"><FileXls className="size-4" />Datos</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canImport && <DropdownMenuItem asChild><Link href="/prevencion/incidentes/importar"><UploadSimple className="size-4" />Importar SFTI</Link></DropdownMenuItem>}
              {canExport && <DropdownMenuItem asChild><Link href="/api/prevencion/incidentes/export"><DownloadSimple className="size-4" />Exportar registro XLSX</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>}
      />
      <IncidentList incidents={incidents} worksites={worksites} counts={counts} canReport={canReport} indicatorContext={indicator ? `Fuente del indicador ${indicator} · ${query.monthFrom ?? "1"}-${query.monthTo ?? "12"}/${query.year ?? ""}` : undefined} />
    </PageContainer>
  )
}
