import type { Metadata } from "next"
import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpManagementReport, getPdtpProgram } from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { resolveSelectedWorksiteId } from "../../pdtp-context"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr"
import { ReporteGestionFilters } from "./reporte-gestion-filters"

export const metadata: Metadata = { title: "Reporte de gestión PDTP" }

type PageProps = {
  params: Promise<{ programId: string }>
  searchParams: Promise<{ faena?: string; actividad?: string; responsable?: string; estado?: string; desde?: string; hasta?: string }>
}

export default async function PdtpManagementReportPage({ params, searchParams }: PageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/reporte")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/reporte")}`)

  const [{ programId }, query] = await Promise.all([params, searchParams])
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const worksites = await listScopedWorksites(worksiteIds)
  const selectedWorksiteId = resolveSelectedWorksiteId(query.faena, worksites)

  const monthFrom = Number.parseInt(query.desde ?? "", 10)
  const monthTo = Number.parseInt(query.hasta ?? "", 10)
  const activityNumber = Number.parseInt(query.actividad ?? "", 10)
  const status: "meets" | "deviates" | undefined = query.estado === "meets" || query.estado === "deviates" ? query.estado : undefined
  const filters = {
    responsibleSlug: query.responsable || undefined,
    activityNumber: Number.isFinite(activityNumber) ? activityNumber : undefined,
    status,
    monthFrom: Number.isFinite(monthFrom) ? monthFrom : undefined,
    monthTo: Number.isFinite(monthTo) ? monthTo : undefined,
  }

  const report = selectedWorksiteId
    ? await getPdtpManagementReport({ programId, worksiteId: selectedWorksiteId, scope: worksiteIds, filters })
    : null

  const downloadParams = new URLSearchParams({ programId, ...(selectedWorksiteId ? { faena: selectedWorksiteId } : {}) })
  if (filters.responsibleSlug) downloadParams.set("responsable", filters.responsibleSlug)
  if (filters.activityNumber !== undefined) downloadParams.set("actividad", String(filters.activityNumber))
  if (filters.status) downloadParams.set("estado", filters.status)
  if (filters.monthFrom !== undefined) downloadParams.set("desde", String(filters.monthFrom))
  if (filters.monthTo !== undefined) downloadParams.set("hasta", String(filters.monthTo))

  return (
    <PageContainer>
      <PageHeader
        title="Reporte de gestión"
        description="Avance, desviaciones y responsables por actividad, igual que en la descarga Excel."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Reporte de gestión" },
          ]} />
        }
        actions={selectedWorksiteId ? (
          <Button asChild size="sm">
            <a href={`/api/prevencion/pdtp/reporte-gestion?${downloadParams}`} download className="flex items-center gap-2">
              <DownloadSimple size={14} />
              Descargar Excel
            </a>
          </Button>
        ) : undefined}
      />

      <ReporteGestionFilters
        programId={programId}
        worksites={worksites}
        responsibleOptions={report?.responsibleOptions ?? []}
        activityOptions={report?.activityOptions ?? []}
        current={{ faena: selectedWorksiteId, actividad: filters.activityNumber, responsable: filters.responsibleSlug, estado: filters.status, desde: filters.monthFrom, hasta: filters.monthTo }}
      />

      {!selectedWorksiteId ? (
        <EmptyState
          compact
          align="start"
          tone="warning"
          title="Selecciona una faena para ver el reporte"
          description="El reporte de gestión se calcula por faena, igual que el resto del programa."
          action={<div className="flex flex-wrap gap-2">{worksites.map((worksite) => <Button key={worksite.id} asChild size="sm"><Link href={`/prevencion/pdtp/${programId}/reporte?faena=${worksite.id}`}>{worksite.name}</Link></Button>)}</div>}
        />
      ) : !report || report.activities.length === 0 ? (
        // A-4: vacío POR FILTRO. La descripción decía "ajusta los filtros" pero
        // no daba forma de hacerlo; el CTA quita los filtros y deja sólo la faena.
        <EmptyState
          compact
          title="Sin actividades para estos filtros"
          description="Ninguna actividad del programa coincide con los filtros aplicados. Quítalos para ver el reporte completo de la faena."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/prevencion/pdtp/${programId}/reporte?faena=${selectedWorksiteId}`}>Quitar filtros</Link>
            </Button>
          }
        />
      ) : (
        <TableRoot stickyHeader className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Actividad</TableHead>
                <TableHead className="text-right">Planificado</TableHead>
                <TableHead className="text-right">Ejecutado</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Responsables</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.activities.map((row) => (
                <TableRow key={row.activityNumber}>
                  <TableCell className="font-mono text-xs text-[var(--color-text-faint)]">{row.activityNumber}</TableCell>
                  <TableCell className="max-w-md font-medium text-[var(--color-text)]">{row.activity}</TableCell>
                  <TableCellNum>{row.planned}</TableCellNum>
                  <TableCellNum>{row.executed}</TableCellNum>
                  <TableCellNum className="font-semibold">{row.percent !== null ? `${Math.round(row.percent * 100)}%` : "—"}</TableCellNum>
                  <TableCell>
                    <MetaBadge meta={{ label: `${row.meetsTarget ? "Cumple meta" : "En desviación"}`, variant: row.meetsTarget ? "success" : "warning" }} dot />
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-[var(--color-text-muted)]">{row.responsibles.join(", ") || "Sin responsable"}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/prevencion/pdtp/${programId}?faena=${selectedWorksiteId}#registros-pdtp`}>Ver registros</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}

      {report && (
        <details className="mt-6 rounded-lg border border-[var(--color-border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Definición de indicadores</summary>
          <dl className="mt-3 space-y-2 text-sm">
            {report.indicatorDefinitions.map((definition) => (
              <div key={definition.code}>
                <dt className="font-medium text-[var(--color-text)]">{definition.label}</dt>
                <dd className="text-xs text-[var(--color-text-muted)]">{definition.formula}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </PageContainer>
  )
}
