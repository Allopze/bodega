import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { desc, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, worksites } from "@/db/schema"
import { requirePermission, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildConsumptionWhere } from "@/lib/combustibles/consumption-queries"
import { getConsumptionDashboard, normalizeConsumptionFilters, getConsumptionByEquipmentType, getEvolutionByVehicle, getWorksiteEquipmentMatrix } from "@/lib/combustibles/consumption-dashboard"
import { getOperationsSummary, getScatterObservations } from "@/lib/combustibles/operations-dashboard"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getAnomalyDistribution } from "@/lib/combustibles/anomaly-cases"
import { settle } from "@/lib/async-settle"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileXls, QrCode, Drop } from "@phosphor-icons/react/dist/ssr"
import { ConsumptionKpis } from "./consumption-kpis"
import { ConsumptionFiltersBar } from "./consumption-filters"
import { ConsumptionAlerts } from "./consumption-alerts"
import { ConsumptionDetailTable } from "./consumption-detail-table"
import { EvolutionChart, PriceEvolutionChart, PatenteRankingChart, RendimientoChart } from "./consumption-charts-lazy"
import { CategoryBarChart } from "./fuel-charts-lazy"
import { OperationsProveedorChart } from "./operations-category-chart"
import { LitersVsKmChart, LitersVsHourMeterChart } from "./scatter-charts"
import { EvolutionByVehicleChart } from "./evolution-by-vehicle-chart"
import { WorksiteEquipmentHeatmap } from "./worksite-equipment-heatmap"
import { AnomalyDistributionChart } from "./anomalias/anomaly-charts-lazy"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { formatCLP, formatQty } from "@/lib/utils"
import { FuelControlOverviewPanel } from "./fuel-control-overview"

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
  const proveedor = str("proveedor")
  const page = typeof sp.page === "string" ? Math.max(1, Number(sp.page)) : 1
  const requestedFilters = normalizeConsumptionFilters({ fromDate, toDate, worksiteId, fuente, patente, associated })

  const worksiteScope = resolveWorksiteScope(session)
  const canImport = can(session, "combustibles:import")
  const canViewTae = can(session, "combustibles:tae_view")

  const ANOMALY_DIST_FALLBACK = { total: 0, byStatus: [], bySeverity: [], byRuleCode: [] }

  const [dashboard, worksitesList, fuentesRows, operationsSummary, controlOverview, byEquipmentType, scatterPoints, evolutionByVehicle, heatmapCells, anomalyDistribution] = await Promise.all([
    settle(getConsumptionDashboard(session, requestedFilters), null, "consumptionDashboard"),
    settle(
      worksiteScope.mode === "none"
        ? Promise.resolve([] as Array<{ id: string; name: string }>)
        : db.query.worksites.findMany({
            where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
            orderBy: [worksites.name],
          }),
      [],
      "worksites",
    ),
    settle(
      db.selectDistinct({ fuente: fuelConsumptionRecords.fuente })
        .from(fuelConsumptionRecords)
        .where(isNotNull(fuelConsumptionRecords.fuente)),
      [],
      "fuentes",
    ),
    settle(getOperationsSummary(session, {
      fromDate: requestedFilters.fromDate,
      toDate: requestedFilters.toDate,
      worksiteId: requestedFilters.worksiteId,
      patente: requestedFilters.patente,
      associated: requestedFilters.associated,
      proveedorNombre: proveedor,
    }), null, "operationsSummary"),
    settle(getFuelControlOverview(session, { filters: requestedFilters, includeTae: canViewTae }), null, "fuelControlOverview"),
    settle(getConsumptionByEquipmentType(session, { fromDate: requestedFilters.fromDate, toDate: requestedFilters.toDate, worksiteId: requestedFilters.worksiteId }), [], "byEquipmentType"),
    settle(getScatterObservations(session, { fromDate: requestedFilters.fromDate, toDate: requestedFilters.toDate, worksiteId: requestedFilters.worksiteId, patente: requestedFilters.patente, proveedorNombre: proveedor }), [], "scatterPoints"),
    settle(getEvolutionByVehicle(session, { fromDate: requestedFilters.fromDate, toDate: requestedFilters.toDate, worksiteId: requestedFilters.worksiteId, patente: requestedFilters.patente }), [], "evolutionByVehicle"),
    settle(getWorksiteEquipmentMatrix(session, { fromDate: requestedFilters.fromDate, toDate: requestedFilters.toDate, worksiteId: requestedFilters.worksiteId }), [], "heatmapCells"),
    settle(getAnomalyDistribution({ worksiteId: requestedFilters.worksiteId }), ANOMALY_DIST_FALLBACK, "anomalyDistribution"),
  ])
  const scatterKm = (scatterPoints ?? []).filter((p) => p.medidoPor === "km")
  const scatterHora = (scatterPoints ?? []).filter((p) => p.medidoPor === "hora")
  // Si el dashboard falló, usamos requestedFilters (que tiene los mismos campos) en vez de dashboard.filters.
  const effectiveFilters = dashboard?.filters ?? requestedFilters

  const detailWhere = buildConsumptionWhere(session, effectiveFilters)
  const [detailRows, detailCountResult] = await Promise.all([
    settle(
      db.query.fuelConsumptionRecords.findMany({
        where: detailWhere,
        with: { vehicle: { columns: { id: true, plate: true, type: true } } },
        orderBy: [desc(fuelConsumptionRecords.periodoDesde), desc(fuelConsumptionRecords.createdAt)],
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
      [],
      "detailRows",
    ),
    settle(
      db.select({ count: sql<number>`count(*)` }).from(fuelConsumptionRecords).where(detailWhere),
      [{ count: 0 }],
      "detailCount",
    ),
  ])
  const totalDetail = detailCountResult[0]?.count ?? 0
  const totalDetailPages = Math.ceil(totalDetail / PAGE_SIZE)

  const fuentes = fuentesRows.map((r) => r.fuente).filter((f): f is string => !!f).sort()
  return (
    <PageContainer>
      <PageHeader
        title="Combustibles"
        description="Control ejecutivo, operación TAE y análisis de consumo TCT en un mismo contexto."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles" }]} />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/combustibles/ciclo"><Drop className="h-4 w-4 mr-1.5" />Ciclo físico</Link>
            </Button>
            {canViewTae && (
              <Button asChild variant="secondary" size="sm">
                <Link href="/combustibles/tae"><QrCode className="h-4 w-4 mr-1.5" />Control TAE</Link>
              </Button>
            )}
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

      {controlOverview && (
        <FuelControlOverviewPanel
          data={controlOverview}
          canViewCosts={can(session, "combustibles:view_costs")}
          tct={{
            liters: dashboard?.kpis.totalCantidad ?? 0,
            transactions: dashboard?.kpis.totalTransacciones ?? 0,
            vehicles: dashboard?.kpis.patentesUnicas ?? 0,
            variationLitersPct: dashboard?.kpis.variacionCantidadPct ?? null,
          }}
          period={{
            fromDate: effectiveFilters.fromDate,
            toDate: effectiveFilters.toDate,
            worksiteId: effectiveFilters.worksiteId,
            source: effectiveFilters.fuente,
            plate: effectiveFilters.patente,
            associated: effectiveFilters.associated,
          }}
        />
      )}

      <div id="analisis-tct" className="scroll-mt-24" />
      {dashboard && <ConsumptionKpis kpis={dashboard.kpis} />}

      <ConsumptionFiltersBar
        worksites={worksitesList}
        fuentes={fuentes}
        currentFilters={effectiveFilters}
        hasExplicitDateRange={Boolean(fromDate || toDate)}
        proveedor={proveedor}
      />

      {dashboard && (
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
              <ChartErrorBoundary chartName="Evolución mensual">
                <EvolutionChart data={dashboard.seriesPorPeriodo} />
              </ChartErrorBoundary>
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
      )}

      {byEquipmentType.length > 0 && (
        <section aria-labelledby="consumo-por-tipo-title" className="mb-8">
          <div className="mb-3">
            <p className="text-eyebrow">Qué se consume</p>
            <h2 id="consumo-por-tipo-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Consumo por tipo de equipo</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Litros totales agrupados por familia de vehículo o maquinaria.</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Litros por tipo de equipo</CardTitle>
              <CardDescription>¿Qué tipo de equipo consume la mayor parte del combustible?</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary chartName="Consumo por tipo de equipo">
                <CategoryBarChart
                  data={byEquipmentType.map((r) => ({ group: r.equipmentTypeName, totalLiters: r.totalLiters, totalAmount: r.totalAmount, count: r.uniqueVehicles }))}
                  title="Tipo de equipo"
                />
              </ChartErrorBoundary>
            </CardContent>
          </Card>
        </section>
      )}

      {(scatterKm.length > 0 || scatterHora.length > 0) && (
        <section aria-labelledby="dispersion-title" className="mb-8 border-t border-[var(--color-border)] pt-7">
          <div className="mb-4">
            <p className="text-eyebrow">Relación litros-medidor</p>
            <h2 id="dispersion-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Dispersión litros vs. medidor</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Cada punto es una carga del log operacional. Sólo filas con lectura de medidor y litros &gt; 0.</p>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Litros vs. kilometraje (odómetro)</CardTitle>
                <CardDescription>{scatterKm.length} cargas con odómetro registrado.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartErrorBoundary chartName="Litros vs kilometraje">
                  <LitersVsKmChart points={scatterKm} />
                </ChartErrorBoundary>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Litros vs. horómetro</CardTitle>
                <CardDescription>{scatterHora.length} cargas con horómetro registrado.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartErrorBoundary chartName="Litros vs horómetro">
                  <LitersVsHourMeterChart points={scatterHora} />
                </ChartErrorBoundary>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {evolutionByVehicle.length > 0 && (
        <section aria-labelledby="evolucion-equipo-title" className="mb-8 border-t border-[var(--color-border)] pt-7">
          <div className="mb-4">
            <p className="text-eyebrow">Seguimiento individual</p>
            <h2 id="evolucion-equipo-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Evolución por equipo</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Litros por período para los equipos que más consumen. Se muestra hasta 8 series.</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumo por período y equipo</CardTitle>
              <CardDescription>¿Qué equipos están aumentando o reduciendo su consumo a lo largo del tiempo?</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary chartName="Evolución por equipo">
                <EvolutionByVehicleChart points={evolutionByVehicle} />
              </ChartErrorBoundary>
            </CardContent>
          </Card>
        </section>
      )}

      {heatmapCells.length > 0 && (
        <section aria-labelledby="heatmap-title" className="mb-8 border-t border-[var(--color-border)] pt-7">
          <div className="mb-4">
            <p className="text-eyebrow">Relación estructural</p>
            <h2 id="heatmap-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Matriz faena × equipo</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Litros por combinación de faena y equipo. La intensidad del color indica consumo relativo.</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">¿Dónde y qué equipo consume más?</CardTitle>
              <CardDescription>Top 12 faenas × 12 equipos. Hover sobre cada celda para ver el detalle exacto.</CardDescription>
            </CardHeader>
            <CardContent>
              <WorksiteEquipmentHeatmap cells={heatmapCells} />
            </CardContent>
          </Card>
        </section>
      )}

      {anomalyDistribution.total > 0 && (
        <section aria-labelledby="anomaly-distribution-title" className="mb-8 border-t border-[var(--color-border)] pt-7">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-eyebrow">Control y anomalías</p>
              <h2 id="anomaly-distribution-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Distribución de anomalías</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {anomalyDistribution.total} casos activos. <Link href="/combustibles/anomalias" className="text-[var(--color-primary-ink)] hover:underline">Ver todos los casos</Link>
              </p>
            </div>
          </div>
          <AnomalyDistributionChart distribution={anomalyDistribution} />
        </section>
      )}

      {dashboard && (
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
              <ChartErrorBoundary chartName="Rendimiento por patente">
                <RendimientoChart data={dashboard.rendimientoPorPatente} />
              </ChartErrorBoundary>
            </CardContent>
          </Card>
          </div>
        </section>
      )}

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
              <CardHeader>
                <CardTitle className="text-base">Gasto por faena</CardTitle>
                <CardDescription>¿Qué faena concentra el gasto de combustible del log operacional?</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBarChart data={operationsSummary.porFaena.map((f) => ({ group: f.faena, totalLiters: f.litros, totalAmount: f.monto, count: f.equipos }))} title="Faenas" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gasto por proveedor</CardTitle>
                <CardDescription>¿Con qué proveedor se concentra el volumen y el gasto?</CardDescription>
              </CardHeader>
              <CardContent>
                <OperationsProveedorChart data={operationsSummary.porProveedor.map((p) => ({ group: p.proveedor, totalLiters: p.litros, totalAmount: p.monto, count: p.transacciones }))} />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {dashboard && <ConsumptionAlerts alerts={dashboard.alerts} />}

      <ConsumptionDetailTable
        rows={detailRows}
        page={page}
        totalPages={totalDetailPages}
        total={totalDetail}
      />
    </PageContainer>
  )
}
