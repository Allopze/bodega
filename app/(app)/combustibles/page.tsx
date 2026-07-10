import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { desc, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, worksites } from "@/db/schema"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildConsumptionWhere } from "@/lib/combustibles/consumption-queries"
import { getConsumptionDashboard, normalizeConsumptionFilters } from "@/lib/combustibles/consumption-dashboard"
import { getOperationsSummary } from "@/lib/combustibles/operations-dashboard"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileXls } from "@phosphor-icons/react/dist/ssr"
import { ConsumptionKpis } from "./consumption-kpis"
import { ConsumptionFiltersBar } from "./consumption-filters"
import { ConsumptionAlerts } from "./consumption-alerts"
import { ConsumptionDetailTable } from "./consumption-detail-table"
import { EvolutionChart, PriceEvolutionChart, PatenteRankingChart, RendimientoChart } from "./consumption-charts-lazy"
import { formatCLP, formatQty } from "@/lib/utils"

export const metadata: Metadata = { title: "Combustibles" }

const PAGE_SIZE = 50

export default async function CombustiblesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const str = (key: string) => (typeof sp[key] === "string" ? sp[key] : undefined)
  const fromDate = str("desde")
  const toDate = str("hasta")
  const worksiteId = str("faena")
  const fuente = str("fuente")
  const patente = str("patente")
  const associated = str("asociacion") as "yes" | "no" | undefined
  const page = typeof sp.page === "string" ? Math.max(1, Number(sp.page)) : 1
  const requestedFilters = normalizeConsumptionFilters({ fromDate, toDate, worksiteId, fuente, patente, associated })

  const worksiteScope = resolveWorksiteScope(session)

  const [dashboard, worksitesList, fuentesRows, operationsSummary] = await Promise.all([
    getConsumptionDashboard(session, requestedFilters),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
    db.selectDistinct({ fuente: fuelConsumptionRecords.fuente })
      .from(fuelConsumptionRecords)
      .where(isNotNull(fuelConsumptionRecords.fuente)),
    getOperationsSummary(session, {
      fromDate: requestedFilters.fromDate,
      toDate: requestedFilters.toDate,
      worksiteId: requestedFilters.worksiteId,
      patente: requestedFilters.patente,
      associated: requestedFilters.associated,
    }),
  ])
  const effectiveFilters = dashboard.filters

  const detailWhere = buildConsumptionWhere(session, effectiveFilters)
  const [detailRows, detailCountResult] = await Promise.all([
    db.query.fuelConsumptionRecords.findMany({
      where: detailWhere,
      with: { vehicle: { columns: { id: true, plate: true, type: true } } },
      orderBy: [desc(fuelConsumptionRecords.periodoDesde), desc(fuelConsumptionRecords.createdAt)],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    db.select({ count: sql<number>`count(*)` }).from(fuelConsumptionRecords).where(detailWhere),
  ])
  const totalDetail = detailCountResult[0]?.count ?? 0
  const totalDetailPages = Math.ceil(totalDetail / PAGE_SIZE)

  const fuentes = fuentesRows.map((r) => r.fuente).filter((f): f is string => !!f).sort()
  const canImport = can(session, "combustibles:import")

  return (
    <PageContainer>
      <PageHeader
        title="Combustibles"
        description="Análisis de consumo por patente — tarjetas, transacciones, rendimiento y gasto"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles" }]} />}
        headerActions={
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/combustibles/facturas"><FileXls className="h-4 w-4 mr-1.5" />Facturas</Link>
            </Button>
            {canImport && (
              <Button asChild size="sm">
                <Link href="/combustibles/importar"><Upload className="h-4 w-4 mr-1.5" />Importar consumos</Link>
              </Button>
            )}
          </div>
        }
      />

      <ConsumptionKpis kpis={dashboard.kpis} />

      <ConsumptionFiltersBar
        worksites={worksitesList}
        fuentes={fuentes}
        currentFilters={effectiveFilters}
        hasExplicitDateRange={Boolean(fromDate || toDate)}
      />

      <section aria-labelledby="consumo-evolucion-title" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-eyebrow">Lectura del período</p>
            <h2 id="consumo-evolucion-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Tendencia y precio</h2>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">{effectiveFilters.fromDate} a {effectiveFilters.toDate}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.9fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumo y gasto por período</CardTitle>
              <CardDescription>La lectura conjunta muestra si el gasto acompaña al volumen cargado.</CardDescription>
            </CardHeader>
          <CardContent>
            <EvolutionChart data={dashboard.seriesPorPeriodo} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Precio promedio</CardTitle>
            <CardDescription>CLP por litro, aislado de la variación por cantidad.</CardDescription>
          </CardHeader>
          <CardContent>
            <PriceEvolutionChart data={dashboard.seriesPorPeriodo} />
          </CardContent>
        </Card>
        </div>
      </section>

      <section aria-labelledby="consumo-rankings-title" className="mb-8">
        <div className="mb-3">
          <p className="text-eyebrow">Dónde actuar</p>
          <h2 id="consumo-rankings-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Patentes bajo observación</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mayor consumo</CardTitle>
            <CardDescription>Selecciona una barra para abrir el detalle de la patente.</CardDescription>
          </CardHeader>
          <CardContent>
            <PatenteRankingChart data={dashboard.topPatentesPorConsumo} metric="cantidad" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mayor gasto</CardTitle>
            <CardDescription>Prioriza el costo antes de revisar cargas individuales.</CardDescription>
          </CardHeader>
          <CardContent>
            <PatenteRankingChart data={dashboard.topPatentesPorGasto} metric="monto" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Más transacciones</CardTitle>
            <CardDescription>Señala cargas fraccionadas o actividad inusual.</CardDescription>
          </CardHeader>
          <CardContent>
            <PatenteRankingChart data={dashboard.transaccionesPorPatente} metric="transacciones" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rendimiento por patente</CardTitle>
            <CardDescription>Las barras ámbar requieren una revisión de operación o dato fuente.</CardDescription>
          </CardHeader>
          <CardContent>
            <RendimientoChart data={dashboard.rendimientoPorPatente} />
          </CardContent>
        </Card>
        </div>
      </section>

      {operationsSummary && (
        <section aria-labelledby="log-operacional-title" className="mb-8 border-t border-[var(--color-border)] pt-7">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-eyebrow">Registro transaccional</p>
              <h2 id="log-operacional-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Log operacional de combustible</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Comparte período, faena, patente y asociación con el análisis superior.</p>
            </div>
            <p className="font-mono text-sm text-[var(--color-text-muted)]">
              {formatQty(Math.round(operationsSummary.totalLitros), "L")} · {formatCLP(operationsSummary.totalMonto)}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Equipos con mayor gasto</CardTitle>
                <CardDescription>{operationsSummary.totalEquipos} equipos, {operationsSummary.totalRegistros} cargas registradas.</CardDescription>
              </CardHeader>
              <CardContent>
                <PatenteRankingChart data={operationsSummary.topEquiposPorGasto} metric="monto" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rendimiento por equipo</CardTitle>
                <CardDescription>La comparación pondera cada lectura por litros cargados.</CardDescription>
              </CardHeader>
              <CardContent>
                <RendimientoChart data={operationsSummary.rendimientoPorEquipo} />
              </CardContent>
            </Card>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Gasto por faena</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {operationsSummary.porFaena.slice(0, 10).map((f) => (
                  <div key={f.faena} className="flex items-center justify-between gap-3">
                    <span className="truncate">{f.faena} <span className="text-muted-foreground">({f.equipos} equipos)</span></span>
                    <span className="font-mono shrink-0">{formatCLP(f.monto)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Gasto por proveedor</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {operationsSummary.porProveedor.slice(0, 10).map((p) => (
                  <div key={p.proveedor} className="flex items-center justify-between gap-3">
                    <span className="truncate">{p.proveedor} <span className="text-muted-foreground">({p.transacciones} cargas)</span></span>
                    <span className="font-mono shrink-0">{formatCLP(p.monto)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <ConsumptionAlerts alerts={dashboard.alerts} />

      <ConsumptionDetailTable
        rows={detailRows}
        page={page}
        totalPages={totalDetailPages}
        total={totalDetail}
      />
    </PageContainer>
  )
}
