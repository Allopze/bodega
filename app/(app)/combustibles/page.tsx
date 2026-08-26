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
import { logger } from "@/lib/logger"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileXls, QrCode, Drop } from "@phosphor-icons/react/dist/ssr"
import { ConsumptionAnalysisMetrics, ConsumptionKpis } from "./consumption-kpis"
import { ConsumptionFiltersBar } from "./consumption-filters"
import { ConsumptionAlerts } from "./consumption-alerts"
import { ConsumptionDetailTable } from "./consumption-detail-table"
import { EvolutionChart, PriceEvolutionChart, PatenteRankingChart, RendimientoChart } from "./consumption-charts-lazy"
import { CategoryBarChart } from "./fuel-charts-lazy"
import { OperationsProveedorChart } from "./operations-category-chart"
import { EvolutionByVehicleChart, LitersVsHourMeterChart, LitersVsKmChart } from "./operations-charts-lazy"
import { WorksiteEquipmentHeatmap } from "./worksite-equipment-heatmap"
import { AnomalyDistributionChart } from "./anomalias/anomaly-charts-lazy"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { formatCLP, formatDate, formatQty, cn, pluralize, parsePageParam } from "@/lib/utils"
import { FuelControlOverviewPanel } from "./fuel-control-overview"

export const metadata: Metadata = { title: "Combustibles" }

const PAGE_SIZE = 50
const ANOMALY_DIST_FALLBACK = { total: 0, byStatus: [], bySeverity: [], byRuleCode: [] }
/** Unidad del rendimiento tal como la guarda el log operacional. */
const RENDIMIENTO_UNIT_LABEL: Record<string, string> = { km_lt: "km/L", lt_hr: "L/h" }

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
  const requestedVista = str("vista")
  const vista: "resumen" | "analisis" | "registros" =
    requestedVista === "analisis" || requestedVista === "registros" ? requestedVista : "resumen"
  const needsSummary = vista === "resumen"
  const needsAnalysis = vista === "analisis"
  const needsDashboard = needsSummary || needsAnalysis
  const needsRecords = vista === "registros"
  // parsePageParam: `?page=` no numérico → 1, no NaN (guard compartido).
  const page = parsePageParam(sp.page)
  const requestedFilters = normalizeConsumptionFilters({ fromDate, toDate, worksiteId, fuente, patente, associated })

  const worksiteScope = resolveWorksiteScope(session)
  const canImport = can(session, "combustibles:import")
  const canViewTae = can(session, "combustibles:tae_view")
  const canViewCosts = can(session, "combustibles:view_costs")

  // Fuentes que fallaron y cayeron a su fallback — a diferencia de `settle`
  // (que sólo loguea), esta página necesita saber CUÁLES para no leer un
  // fallback vacío como "no hay datos" (CO-037): "Sin datos de análisis" es
  // una afirmación activa y falsa cuando en realidad la consulta reventó.
  const degradedSources: string[] = []
  let trackedCount = 0
  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
    trackedCount++
    return promise.catch((error: unknown) => {
      logger.error(`[combustibles] ${label} falló`, error)
      degradedSources.push(label)
      return fallback
    })
  }

  const [dashboard, worksitesList, fuentesRows, operationsSummary, controlOverview, byEquipmentType, scatterPoints, evolutionByVehicle, heatmapCells, anomalyDistribution] = await Promise.all([
    needsDashboard
      ? track(getConsumptionDashboard(session, requestedFilters), null, "consumptionDashboard")
      : Promise.resolve(null),
    track(
      worksiteScope.mode === "none"
        ? Promise.resolve([] as Array<{ id: string; name: string }>)
        : db.query.worksites.findMany({
            where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
            orderBy: [worksites.name],
          }),
      [],
      "worksites",
    ),
    track(
      db.selectDistinct({ fuente: fuelConsumptionRecords.fuente })
        .from(fuelConsumptionRecords)
        .where(isNotNull(fuelConsumptionRecords.fuente)),
      [],
      "fuentes",
    ),
    needsAnalysis
      ? track(getOperationsSummary(session, {
          fromDate: requestedFilters.fromDate,
          toDate: requestedFilters.toDate,
          worksiteId: requestedFilters.worksiteId,
          patente: requestedFilters.patente,
          associated: requestedFilters.associated,
          proveedorNombre: proveedor,
        }), null, "operationsSummary")
      : Promise.resolve(null),
    needsSummary
      ? track(getFuelControlOverview(session, { filters: requestedFilters, includeTae: canViewTae }), null, "fuelControlOverview")
      : Promise.resolve(null),
    // Filtros COMPLETOS: estos gráficos recibían sólo período y faena, así que
    // Fuente, Patente y Asociación quedaban sin efecto sobre ellos mientras los
    // KPIs de la misma vista sí los aplicaban.
    needsAnalysis
      ? track(getConsumptionByEquipmentType(session, requestedFilters), [], "byEquipmentType")
      : Promise.resolve([]),
    needsAnalysis
      ? track(getScatterObservations(session, { fromDate: requestedFilters.fromDate, toDate: requestedFilters.toDate, worksiteId: requestedFilters.worksiteId, patente: requestedFilters.patente, proveedorNombre: proveedor }), [], "scatterPoints")
      : Promise.resolve([]),
    needsAnalysis
      ? track(getEvolutionByVehicle(session, requestedFilters), [], "evolutionByVehicle")
      : Promise.resolve([]),
    needsAnalysis
      ? track(getWorksiteEquipmentMatrix(session, requestedFilters), [], "heatmapCells")
      : Promise.resolve([]),
    needsAnalysis
      // Sólo casos vigentes: sin el filtro de estado, "N casos activos" incluía
      // los resueltos y descartados y nunca bajaba.
      ? track(getAnomalyDistribution({ worksiteId: requestedFilters.worksiteId, status: ["open", "in_review", "reopened"] }, session), ANOMALY_DIST_FALLBACK, "anomalyDistribution")
      : Promise.resolve(ANOMALY_DIST_FALLBACK),
  ])
  const scatterKm = (scatterPoints ?? []).filter((p) => p.medidoPor === "km")
  const scatterHora = (scatterPoints ?? []).filter((p) => p.medidoPor === "hora")
  // Si el dashboard falló, usamos requestedFilters (que tiene los mismos campos) en vez de dashboard.filters.
  const effectiveFilters = dashboard?.filters ?? requestedFilters
  const chartPeriodLabel = `${formatDate(effectiveFilters.fromDate)} a ${formatDate(effectiveFilters.toDate)}`

  const detailWhere = buildConsumptionWhere(session, effectiveFilters)
  const [detailRowsRaw, detailCountResult] = await Promise.all([
    needsRecords
      ? track(
      db.query.fuelConsumptionRecords.findMany({
        where: detailWhere,
        columns: {
          id: true,
          batchId: true,
          patente: true,
          numeroTarjetas: true,
          numeroTransacciones: true,
          cantidadUnidad: true,
          monto: canViewCosts,
          precioPromedioUnidad: canViewCosts,
          rendimientoPromedio: true,
          periodoDesde: true,
          periodoHasta: true,
          fuente: true,
        },
        with: { vehicle: { columns: { id: true, plate: true, type: true } } },
        orderBy: [desc(fuelConsumptionRecords.periodoDesde), desc(fuelConsumptionRecords.createdAt)],
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
      [],
      "detailRows",
      )
      : Promise.resolve([]),
    track(
      db.select({ count: sql<number>`count(*)` }).from(fuelConsumptionRecords).where(detailWhere),
      [{ count: 0 }],
      "detailCount",
    ),
  ])
  const redactAmount = (value: unknown) => canViewCosts && typeof value === "number" ? value : null
  const detailRows = detailRowsRaw.map((row) => ({
    ...row,
    monto: redactAmount((row as { monto?: unknown }).monto),
    precioPromedioUnidad: redactAmount((row as { precioPromedioUnidad?: unknown }).precioPromedioUnidad),
  }))
  const totalDetail = detailCountResult[0]?.count ?? 0
  // El fallback de detailCount es [{count:0}]: sin esto, un conteo que
  // reventó se leía igual que una tabla real y genuinamente vacía (CO-037).
  const detailCountDegraded = degradedSources.includes("detailCount")

  const fuentes = fuentesRows.map((r) => r.fuente).filter((f): f is string => !!f).sort()

  // Navegación por pestañas conservando los filtros activos en la URL. El split
  // separa el uso diario (Resumen), el análisis profundo (Análisis) y el detalle
  // transaccional (Registros) — antes todo vivía apilado en una sola página.
  const vistaHref = (target: "resumen" | "analisis" | "registros") => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (k === "vista" || k === "page") continue
      if (typeof v === "string" && v) params.set(k, v)
    }
    if (target !== "resumen") params.set("vista", target)
    const qs = params.toString()
    return `/combustibles${qs ? `?${qs}` : ""}`
  }
  // "Sin asociación" en los KPIs de resumen respalda su cifra enlazando a
  // Registros ya filtrado por `asociacion=no`, en vez de dejar al usuario
  // reconstruir el filtro a mano.
  const sinAsociacionHref = (() => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (k === "vista" || k === "page" || k === "asociacion") continue
      if (typeof v === "string" && v) params.set(k, v)
    }
    params.set("vista", "registros")
    params.set("asociacion", "no")
    return `/combustibles?${params.toString()}`
  })()
  const VISTA_TABS: Array<{ key: "resumen" | "analisis" | "registros"; label: string }> = [
    { key: "resumen", label: "Resumen" },
    { key: "analisis", label: "Análisis" },
    { key: "registros", label: `Registros${!detailCountDegraded && totalDetail > 0 ? ` · ${totalDetail}` : ""}` },
  ]
  // `Boolean(dashboard)` volvía esto siempre verdadero: el dashboard existe aunque
  // no haya ni una fila, así que el estado vacío era inalcanzable y la vista
  // Análisis mostraba cuatro tarjetas con gráficos en blanco.
  const hasAnalysisContent = byEquipmentType.length > 0 || scatterKm.length > 0 || scatterHora.length > 0
    || evolutionByVehicle.length > 0 || heatmapCells.length > 0 || anomalyDistribution.total > 0
    || (dashboard?.seriesPorPeriodo.length ?? 0) > 0
    || (operationsSummary?.totalRegistros ?? 0) > 0

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
            {canViewCosts && <Button asChild variant="secondary" size="sm">
              <Link href="/combustibles/facturas"><FileXls className="h-4 w-4 mr-1.5" />Facturas</Link>
            </Button>}
            {canImport && (
              <Button asChild size="sm">
                <Link href="/combustibles/importar"><Upload className="h-4 w-4 mr-1.5" />Importar consumos</Link>
              </Button>
            )}
          </div>
        }
      />

      <DegradedDataBanner degraded={degradedSources} total={trackedCount} />

      {needsSummary && controlOverview && (
        <FuelControlOverviewPanel
          data={controlOverview}
          canViewCosts={canViewCosts}
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

      <ConsumptionFiltersBar
        worksites={worksitesList}
        fuentes={fuentes}
        currentFilters={effectiveFilters}
        hasExplicitDateRange={Boolean(fromDate || toDate)}
        proveedor={proveedor}
      />

      <div className="mb-6 mt-2 flex items-end gap-0 border-b border-[var(--color-border)]">
        {VISTA_TABS.map((tab) => {
          const active = vista === tab.key
          return (
            <Link
              key={tab.key}
              href={vistaHref(tab.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-4 pb-2.5 pt-1 text-sm font-medium transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                active
                  ? "border-[var(--color-text)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {vista === "resumen" && (
        <>
      {dashboard && <ConsumptionKpis kpis={dashboard.kpis} canViewCosts={canViewCosts} hrefs={{ registros: vistaHref("registros"), sinAsociacion: sinAsociacionHref }} />}

      {dashboard && (
        <section aria-labelledby="consumo-evolucion-title" className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-eyebrow">Lectura del período</p>
              <h2 id="consumo-evolucion-title" className="text-lg font-semibold tracking-tight text-[var(--color-text)]">{canViewCosts ? "Tendencia y precio" : "Tendencia de consumo"}</h2>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">{chartPeriodLabel}</p>
          </div>
          <div className={canViewCosts ? "grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.9fr)]" : "grid grid-cols-1 gap-5"}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{canViewCosts ? "Consumo y gasto por período" : "Consumo por período"}</CardTitle>
                <CardDescription>{canViewCosts ? "La lectura conjunta muestra si el gasto acompaña al volumen cargado." : "Evolución del volumen cargado dentro del período filtrado."}</CardDescription>
              </CardHeader>
            <CardContent>
              <ChartErrorBoundary chartName="Evolución mensual">
                <EvolutionChart data={dashboard.seriesPorPeriodo} showCosts={canViewCosts} />
              </ChartErrorBoundary>
            </CardContent>
          </Card>
          {canViewCosts && <Card>
            <CardHeader>
              <CardTitle className="text-base">Precio promedio</CardTitle>
              <CardDescription>CLP por litro, aislado de la variación por cantidad.</CardDescription>
            </CardHeader>
            <CardContent>
              <PriceEvolutionChart data={dashboard.seriesPorPeriodo} />
            </CardContent>
          </Card>}
          </div>
        </section>
      )}

      {dashboard && <ConsumptionAlerts alerts={dashboard.alerts} />}

      <div className="mt-2 border-t border-[var(--color-border)] pt-4">
        <Link href={vistaHref("registros")} className="text-sm font-medium text-[var(--color-primary-ink)] hover:underline">
          {detailCountDegraded ? "Ver registros del período →" : `Ver ${pluralize(totalDetail, "registro")} del período →`}
        </Link>
      </div>
        </>
      )}

      {vista === "analisis" && (
        <>
      {dashboard && hasAnalysisContent && <ConsumptionAnalysisMetrics kpis={dashboard.kpis} canViewCosts={canViewCosts} />}
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
                  data={byEquipmentType.map((r) => ({ group: r.equipmentTypeName, totalLiters: r.totalLiters, totalAmount: r.totalAmount ?? 0, count: r.uniqueVehicles }))}
                  title="Tipo de equipo"
                  metric="liters"
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

      {dashboard && hasAnalysisContent && (
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
          {canViewCosts && <Card>
            <CardHeader>
              <CardTitle className="text-base">Mayor gasto</CardTitle>
              <CardDescription>Prioriza el costo antes de revisar cargas individuales.</CardDescription>
            </CardHeader>
            <CardContent>
              <PatenteRankingChart data={dashboard.topPatentesPorGasto} metric="monto" />
            </CardContent>
          </Card>}
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
              {formatQty(Math.round(operationsSummary.totalLitros), "L")}
              {canViewCosts && operationsSummary.totalMonto != null && <> · {formatCLP(operationsSummary.totalMonto)}</>}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* combustibles:view_costs: tres de las cuatro tarjetas de esta
                sección están enteramente enmarcadas en gasto (ordenadas y
                graficadas por monto) — no hay una variante "sólo litros"
                razonable, así que se ocultan enteras en vez de mostrar un
                gráfico de "gasto" sin el monto. */}
            {canViewCosts && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Equipos con mayor gasto</CardTitle>
                <CardDescription>{operationsSummary.totalEquipos} equipos, {operationsSummary.totalRegistros} cargas registradas.</CardDescription>
              </CardHeader>
              <CardContent>
                <PatenteRankingChart data={operationsSummary.topEquiposPorGasto} metric="monto" />
              </CardContent>
            </Card>
            )}
            {/* Un gráfico por unidad (A5b): km/L y L/h no comparten eje — más
                km/L es mejor, más L/h es peor, y las escalas no son comparables. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rendimiento por equipo</CardTitle>
                <CardDescription>La comparación pondera cada lectura por litros cargados y separa km/L de L/h.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {[...new Set(operationsSummary.rendimientoPorEquipo.map((row) => row.unidad))].map((unidad) => (
                  <div key={unidad ?? "sin-unidad"}>
                    <p className="mb-1 text-eyebrow">{RENDIMIENTO_UNIT_LABEL[unidad ?? ""] ?? "Unidad no informada"}</p>
                    <RendimientoChart
                      data={operationsSummary.rendimientoPorEquipo.filter((row) => row.unidad === unidad)}
                      unitLabel={RENDIMIENTO_UNIT_LABEL[unidad ?? ""]}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{canViewCosts ? "Gasto por faena" : "Consumo por faena"}</CardTitle>
                <CardDescription>{canViewCosts ? "¿Qué faena concentra el gasto de combustible del log operacional?" : "¿Qué faena concentra el volumen de combustible del log operacional?"}</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBarChart data={operationsSummary.porFaena.map((f) => ({ group: f.faena, totalLiters: f.litros, totalAmount: f.monto ?? 0, count: f.equipos }))} title="Faenas" metric={canViewCosts ? "amount" : "liters"} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{canViewCosts ? "Gasto por proveedor" : "Consumo por proveedor"}</CardTitle>
                <CardDescription>{canViewCosts ? "¿Con qué proveedor se concentra el volumen y el gasto?" : "¿Con qué proveedor se concentra el volumen cargado?"}</CardDescription>
              </CardHeader>
              <CardContent>
                <OperationsProveedorChart data={operationsSummary.porProveedor.map((p) => ({ group: p.proveedor, totalLiters: p.litros, totalAmount: p.monto ?? 0, count: p.transacciones }))} metric={canViewCosts ? "amount" : "liters"} />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* "Sin datos" es una afirmación activa: sólo es cierta cuando ninguna
          fuente de esta vista falló. Con degradación, el banner de arriba ya
          explica por qué no hay nada que mostrar — repetir "ajusta el rango"
          sería instrucción activa y falsa (CO-037). */}
      {!hasAnalysisContent && degradedSources.length === 0 && (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-10 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">Sin datos de análisis en el período</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Ajusta el rango de fechas o la faena, o importa consumos para ver gráficos de tendencia, rendimiento y anomalías.</p>
        </div>
      )}
        </>
      )}

      {vista === "registros" && (
        <>
          {detailCountDegraded && (
            <p className="mb-3 text-sm text-[var(--color-warning-ink)]">
              El total de registros no se pudo calcular; se muestra igual la página actual.
            </p>
          )}
          <ConsumptionDetailTable
            rows={detailRows}
            page={page}
            total={totalDetail}
            pageSize={PAGE_SIZE}
            canViewCosts={canViewCosts}
          />
        </>
      )}
    </PageContainer>
  )
}
