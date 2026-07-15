import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { ArrowsLeftRight, Upload } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelStorageLocations, fuelTaeEvidence, fuelTaeLoadingPoints, fuelTaePublicLinks, fuelTaeSubmissions, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TaeAccessPanel } from "./tae-access-panel"
import { TaeExportButton } from "./tae-export-button"
import { TaeFilters } from "./tae-filters"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getTaeGroupedTotals } from "@/lib/combustibles/tae-dashboard"
import { TaeGroupChart } from "./tae-group-chart"

export const metadata: Metadata = { title: "Control TAE" }

const STATUS: Record<string, { label: string; variant: "primary" | "warning" | "success" | "danger" }> = {
  submitted: { label: "Recibida", variant: "primary" },
  observed: { label: "Observada", variant: "warning" },
  validated: { label: "Validada", variant: "success" },
  voided: { label: "Anulada", variant: "danger" },
}

const PAGE_SIZE = 50

type TaeSearchParams = { q?: string; from?: string; to?: string; faena?: string; punto?: string; estado?: string; sello?: string; evidencia?: string; page?: string }

export default async function TaeControlPage({ searchParams }: { searchParams: Promise<TaeSearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view") } catch { redirect("/forbidden") }
  const raw = await searchParams
  const filters = {
    q: raw.q?.trim().slice(0, 120) ?? "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(raw.from ?? "") ? raw.from! : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(raw.to ?? "") ? raw.to! : "",
    worksiteId: raw.faena?.trim() ?? "",
    loadingPointId: raw.punto?.trim() ?? "",
    status: ["submitted", "observed", "validated", "voided"].includes(raw.estado ?? "") ? raw.estado! : "",
    seal: raw.sello === "faltante" ? "missing" : "",
    evidence: raw.evidencia === "faltante" ? "missing" : "",
  }
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1)
  const scope = resolveWorksiteScope(session)
  const worksiteWhere = scope.mode === "all" ? undefined : scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined
  const conditions = [
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    filters.loadingPointId ? eq(fuelTaeSubmissions.loadingPointId, filters.loadingPointId) : undefined,
    filters.status ? eq(fuelTaeSubmissions.status, filters.status) : undefined,
    filters.seal ? sql`(${fuelTaeSubmissions.removedSealNumber} is null or btrim(${fuelTaeSubmissions.removedSealNumber}) = '' or ${fuelTaeSubmissions.installedSealNumber} is null or btrim(${fuelTaeSubmissions.installedSealNumber}) = '')` : undefined,
    filters.evidence ? sql`(select count(distinct ${fuelTaeEvidence.kind}) from ${fuelTaeEvidence} where ${fuelTaeEvidence.submissionId} = ${fuelTaeSubmissions.id}) < 4` : undefined,
    filters.from ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined,
    filters.to ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined,
    filters.q ? or(
      ilike(fuelTaeSubmissions.equipmentCodeSnapshot, `%${filters.q}%`),
      ilike(fuelTaeSubmissions.plateSnapshot, `%${filters.q}%`),
      ilike(fuelTaeSubmissions.supervisorNameSnapshot, `%${filters.q}%`),
      ilike(fuelTaeSubmissions.driverNameSnapshot, `%${filters.q}%`),
    ) : undefined,
  ].filter((condition) => condition !== undefined)
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const now = new Date()
  const chartRange = {
    worksiteId: filters.worksiteId || undefined,
    from: filters.from || new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: filters.to || now.toISOString().slice(0, 10),
  }
  const bitacoraGroupHref = (q: string) => `/combustibles/bitacora?${new URLSearchParams({ q, desde: chartRange.from, hasta: chartRange.to, fuente: "tae_pwa" }).toString()}`

  const TAEGROUP_FALLBACK: Array<{ name: string; liters: number; group: string; count: number }> = []

  const [worksitesList, loadingPoints, storageLocations, publicLinks, submissions, metricsRows, cargasPorSupervisor, cargasPorConductor, cargasPorPunto] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({ where: worksiteWhere, columns: { id: true, name: true }, orderBy: [worksites.name] }),
      [] as Array<{ id: string; name: string }>,
      "tae-worksites",
    ),
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.fuelTaeLoadingPoints.findMany({ where: scope.mode === "some" ? inArray(fuelTaeLoadingPoints.worksiteId, scope.ids) : undefined, columns: { id: true, worksiteId: true, name: true, type: true, storageLocationId: true }, orderBy: [fuelTaeLoadingPoints.name] }),
      [] as Array<{ id: string; worksiteId: string; name: string; type: string; storageLocationId: string | null }>,
      "tae-loadingPoints",
    ),
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.fuelStorageLocations.findMany({ where: and(eq(fuelStorageLocations.isActive, true), scope.mode === "some" ? inArray(fuelStorageLocations.worksiteId, scope.ids) : undefined), columns: { id: true, worksiteId: true, name: true } }),
      [] as Array<{ id: string; worksiteId: string; name: string }>,
      "tae-storageLocations",
    ),
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.fuelTaePublicLinks.findMany({ where: scope.mode === "some" ? inArray(fuelTaePublicLinks.worksiteId, scope.ids) : undefined, with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } } }, orderBy: [desc(fuelTaePublicLinks.createdAt)] }),
      [],
      "tae-publicLinks",
    ),
    settle(
      db.query.fuelTaeSubmissions.findMany({ where, with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } }, product: { columns: { name: true } } }, orderBy: [desc(fuelTaeSubmissions.loadedAt)], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      [],
      "tae-submissions",
    ),
    settle(
      db.select({
        total: count(),
        liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
        observed: sql<number>`count(*) filter (where ${fuelTaeSubmissions.status} = 'observed')`,
        pending: sql<number>`count(*) filter (where ${fuelTaeSubmissions.status} = 'submitted')`,
      }).from(fuelTaeSubmissions).where(where),
      [{ total: 0, liters: 0, observed: 0, pending: 0 }],
      "tae-metrics",
    ),
    settle(getTaeGroupedTotals(session, chartRange, "supervisor"), TAEGROUP_FALLBACK, "tae-group-supervisor"),
    settle(getTaeGroupedTotals(session, chartRange, "driver"), TAEGROUP_FALLBACK, "tae-group-driver"),
    settle(getTaeGroupedTotals(session, chartRange, "loadingPoint"), TAEGROUP_FALLBACK, "tae-group-loadingPoint"),
  ])
  const metrics = metricsRows[0] ?? { total: 0, liters: 0, observed: 0, pending: 0 }
  const totalPages = Math.max(1, Math.ceil(Number(metrics.total) / PAGE_SIZE))
  const canConfigure = can(session, "combustibles:tae_manage_config")
  const canExport = can(session, "combustibles:tae_export")
  const canImport = can(session, "combustibles:tae_import")

  return (
    <PageContainer>
      <PageHeader
        title="Control TAE"
        description="Cargas físicas registradas desde el formulario público de Copec TAE."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE" }]} />}
        actions={<div className="flex gap-2">
          <Button asChild variant="secondary" size="sm"><Link href="/combustibles/tae/conciliacion"><ArrowsLeftRight className="mr-1 h-4 w-4" />Conciliación</Link></Button>
          {canImport && <Button asChild variant="secondary" size="sm"><Link href="/combustibles/tae/importar"><Upload className="mr-1 h-4 w-4" />Importar histórico</Link></Button>}
          {canExport && <TaeExportButton filters={filters} />}
        </div>}
      />

      <section className="mb-5 grid grid-cols-2 gap-px border border-(--color-border) bg-(--color-border) md:grid-cols-4">
        <div className="bg-(--color-surface) p-4"><p className="text-eyebrow">Resultados</p><p className="mt-1 font-mono text-xl tabular-nums">{Number(metrics.total).toLocaleString("es-CL")}</p></div>
        <div className="bg-(--color-surface) p-4"><p className="text-eyebrow">Litros</p><p className="mt-1 font-mono text-xl tabular-nums">{Number(metrics.liters).toLocaleString("es-CL")}</p></div>
        <div className="bg-(--color-surface) p-4"><p className="text-eyebrow">Observadas</p><p className="mt-1 font-mono text-xl tabular-nums">{Number(metrics.observed).toLocaleString("es-CL")}</p></div>
        <div className="bg-(--color-surface) p-4"><p className="text-eyebrow">Pendientes de validar</p><p className="mt-1 font-mono text-xl tabular-nums">{Number(metrics.pending).toLocaleString("es-CL")}</p></div>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Litros por supervisor</CardTitle>
            <CardDescription>¿Qué supervisor concentra el volumen repartido? {!filters.from && !filters.to && "Últimos 90 días."}</CardDescription>
          </CardHeader>
          <CardContent><TaeGroupChart data={cargasPorSupervisor} drilldownHref={bitacoraGroupHref} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Litros por conductor</CardTitle>
            <CardDescription>¿Qué conductor recibió más litros en el período?</CardDescription>
          </CardHeader>
          <CardContent><TaeGroupChart data={cargasPorConductor} drilldownHref={bitacoraGroupHref} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Litros por punto de suministro</CardTitle>
            <CardDescription>¿Qué punto reparte más? Útil para priorizar dónde reforzar control.</CardDescription>
          </CardHeader>
          <CardContent><TaeGroupChart data={cargasPorPunto} drilldownHref={bitacoraGroupHref} /></CardContent>
        </Card>
      </section>

      {canConfigure && <div className="mb-5"><TaeAccessPanel worksites={worksitesList} loadingPoints={loadingPoints} storageLocations={storageLocations} existingLinks={publicLinks.map((link) => ({ id: link.id, label: link.label, worksiteName: link.worksite?.name ?? "—", loadingPointName: link.loadingPoint?.name ?? null, revokedAt: link.revokedAt }))} /></div>}

      <TaeFilters values={filters} worksites={worksitesList} loadingPoints={loadingPoints} />

      <div className="overflow-x-auto border border-(--color-border)">
        <Table className="min-w-[920px]"><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Faena</TableHead><TableHead>Punto</TableHead><TableHead>Equipo</TableHead><TableHead>Producto</TableHead><TableHead>Litros</TableHead><TableHead>Supervisor</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>
          {submissions.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-[var(--color-text-muted)]">Aún no hay cargas TAE. Genera un QR y compártelo en el punto de carga.</TableCell></TableRow> : submissions.map((item) => { const status = STATUS[item.status] ?? { label: "Recibida", variant: "primary" as const }; return <TableRow key={item.id}><TableCell className="font-mono text-xs">{new Date(item.loadedAt).toLocaleString("es-CL")}</TableCell><TableCell>{item.worksite?.name ?? "—"}</TableCell><TableCell>{item.loadingPoint?.name ?? "—"}</TableCell><TableCell className="font-mono">{item.equipmentCodeSnapshot}</TableCell><TableCell>{item.product?.name ?? "—"}</TableCell><TableCell className="font-mono text-right">{Number(item.liters).toLocaleString("es-CL")} L</TableCell><TableCell>{item.supervisorNameSnapshot}</TableCell><TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={`/combustibles/tae/${item.id}`}>Revisar</Link></Button></TableCell></TableRow> })}
        </TableBody></Table>
      </div>
      {totalPages > 1 && <nav aria-label="Paginación de cargas TAE" className="mt-4 flex items-center justify-between gap-3 text-sm"><span className="text-(--color-text-muted)">Página {Math.min(page, totalPages)} de {totalPages}</span><div className="flex gap-2">{page > 1 && <Button asChild variant="secondary" size="sm"><Link href={{ pathname: "/combustibles/tae", query: { ...raw, page: String(page - 1) } }}>Anterior</Link></Button>}{page < totalPages && <Button asChild variant="secondary" size="sm"><Link href={{ pathname: "/combustibles/tae", query: { ...raw, page: String(page + 1) } }}>Siguiente</Link></Button>}</div></nav>}
    </PageContainer>
  )
}
