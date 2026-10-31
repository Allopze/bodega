import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { getConsumptionByEquipmentType, getConsumptionDashboard, getConsumptionSources, getEvolutionByVehicle, getWorksiteEquipmentMatrix, normalizeConsumptionFilters } from "@/lib/combustibles/consumption-dashboard"
import { buildWatchItems } from "@/lib/combustibles/consumption-watch"
import { consumptionChartWindow } from "@/lib/combustibles/consumption-period"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS, PERFORMANCE_UNIT_LABELS } from "@/lib/combustibles/control/contracts"
import { getLitersByMonthAndMedium, getMeterSeries, getOverviewHeader, getWorksiteMediumCrosstab, hasAnyLoads } from "@/lib/combustibles/control/queries/overview"
import { controlFiltersFromPeriod, exportParamsFromFilters } from "@/lib/combustibles/control/queries/period-filters"
import { pivotMonthlyByMedium } from "@/lib/combustibles/control/view-helpers"
import { percentVariation } from "@/lib/combustibles/fuel-control-overview.helpers"
import { getFuelControlOverview } from "@/lib/combustibles/fuel-control-overview"
import { getOperationsSummary, getScatterObservations } from "@/lib/combustibles/operations-dashboard"
import { monthlyGranularityNote } from "@/lib/combustibles/period/adapters"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, fuelInboxHref, fuelPerformanceHref } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { formatQty } from "@/lib/utils"
import { ConsumoNav } from "../../consumo-nav"
import { ConsumptionFiltersBar } from "../../consumption-filters"
import { ConsumptionWatchList } from "../../consumption-alerts"
import { FuelOriginSummary } from "../../fuel-control-overview"
import { OverviewMeterChart, OverviewMonthlyChart } from "../../control/_charts/overview-charts-lazy"
import { SectionError, ViewSection } from "../../control/_charts/overview-section"
import { ReviewExclusionNote } from "../../control/_charts/performance-review-note"
import { loadControlContext } from "../../control/_components/control-context"
import { ControlFilters } from "../../control/_components/control-filters"
import { hrefInContext, searchWith } from "../../control/_components/page-links"
import { createSourceTracker } from "../../control/_components/track-sources"
import { UrlFold } from "../_components/url-fold"
import { CardsAnalysis } from "./cards-analysis"
import { exportOverviewAction } from "./export-actions"
import { PlanillaAnalysis } from "./planilla-analysis"
import { WorksiteMedium } from "./worksite-medium"

export const metadata: Metadata = { title: "Consumo y rendimiento" }

type SearchParams = Record<string, string | string[] | undefined>

const FOLD_SECTIONS = ["tarjetas", "planilla", "faena-medio"] as const
type FoldSection = (typeof FOLD_SECTIONS)[number]

const first = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

/** Qué cambio porcentual se dice y contra qué: «6 % menos que en septiembre». */
function variationPhrase(pct: number | null, against: string): string | null {
  if (pct === null) return null
  if (Math.abs(pct) < 0.5) return `casi lo mismo que ${against}`
  return `${formatQty(Math.abs(pct), undefined, { maximumFractionDigits: 0 })} % ${pct > 0 ? "más" : "menos"} que ${against}`
}

export default async function ConsumoLitrosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.consumo) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const filters = controlFiltersFromPeriod(period, sp)
  const chartWindow = consumptionChartWindow(period)
  const historyFilters = { ...filters, year: Number(chartWindow.from.slice(0, 4)), months: [] as number[], from: chartWindow.from, to: chartWindow.to }
  const previous = period.prev ? describeFuelPeriod(period.prev, period.source) : null
  const previousFilters = previous ? controlFiltersFromPeriod(previous, sp) : null

  const canExport = can(session, "combustibles:export")
  const canViewCosts = can(session, "combustibles:view") && can(session, "combustibles:view_costs")
  const canViewTae = can(session, "combustibles:tae_view")
  const section = FOLD_SECTIONS.find((candidate) => candidate === first(sp.seccion)) as FoldSection | undefined

  // Filtros del análisis de tarjetas y de la planilla (sólo existen dentro de esas secciones).
  const fuente = first(sp.fuente)
  const patente = first(sp.patente)?.toUpperCase()
  const associated = first(sp.asociacion) === "yes" || first(sp.asociacion) === "no" ? (first(sp.asociacion) as "yes" | "no") : undefined
  const proveedor = first(sp.proveedor)
  const hasCardFilters = Boolean(fuente || patente || associated)

  // Lo de arriba (litros, orígenes, patentes para mirar) usa sólo período y faena: un filtro de tarjetas
  // que sólo existe en una sección plegada no debe cambiar cifras de afuera.
  const baseConsumption = normalizeConsumptionFilters({ fromDate: period.from, toDate: period.to, worksiteId: filters.worksiteId })
  const cardConsumption = normalizeConsumptionFilters({ fromDate: period.from, toDate: period.to, worksiteId: filters.worksiteId, fuente, patente, associated })

  const { track, degraded, total } = createSourceTracker("combustibles/consumo/litros")
  const [ctx, header, previousHeader, monthly, series, origins, dashboard, anyLoads] = await Promise.all([
    loadControlContext(session, { years: false }),
    track(getOverviewHeader(session, filters), null, "litros del período"),
    previousFilters ? track(getOverviewHeader(session, previousFilters), null, "litros del período anterior") : Promise.resolve({ data: null, failed: false }),
    track(getLitersByMonthAndMedium(session, historyFilters), null, "litros por mes y medio"),
    track(getMeterSeries(session, historyFilters), null, "kilómetros y horas contra litros"),
    track(getFuelControlOverview(session, { filters: baseConsumption, includeTae: canViewTae }), null, "origen de lo cargado"),
    track(getConsumptionDashboard(session, baseConsumption), null, "consumo por tarjeta"),
    track(hasAnyLoads(session), true, "cargas en el alcance"),
  ])

  const tarjetasOpen = section === "tarjetas"
  const planillaOpen = section === "planilla"
  const faenaMedioOpen = section === "faena-medio"
  const [cardsDashboard, byType, scatter, evolution, heatmap, sources] = tarjetasOpen
    ? await Promise.all([
      hasCardFilters ? track(getConsumptionDashboard(session, cardConsumption), null, "análisis de tarjetas") : Promise.resolve(dashboard),
      track(getConsumptionByEquipmentType(session, cardConsumption), [], "litros por tipo de equipo"),
      track(getScatterObservations(session, { fromDate: cardConsumption.fromDate, toDate: cardConsumption.toDate, worksiteId: cardConsumption.worksiteId, patente }), [], "litros contra medidor"),
      track(getEvolutionByVehicle(session, cardConsumption), [], "evolución por equipo"),
      track(getWorksiteEquipmentMatrix(session, cardConsumption), [], "matriz faena por equipo"),
      track(getConsumptionSources(session), [], "fuentes de tarjeta"),
    ])
    : [dashboard, null, null, null, null, null] as const
  const planilla = planillaOpen
    ? await track(getOperationsSummary(session, { fromDate: period.from, toDate: period.to, worksiteId: filters.worksiteId, patente, associated, proveedorNombre: proveedor }), null, "planilla de cargas")
    : null
  const crosstabs = faenaMedioOpen
    ? await Promise.all([
      track(getWorksiteMediumCrosstab(session, filters, "km_per_liter"), null, "faenas con equipos de odómetro"),
      track(getWorksiteMediumCrosstab(session, filters, "liters_per_hour"), null, "faenas con equipos de horómetro"),
    ])
    : null

  // ── Enlaces con el período y la faena de esta pantalla ──
  const inContext = (href: string) => hrefInContext(href, period, filters.worksiteId)
  const addCard = fuelAddDataOptions(session).find((option) => option.kind === "tarjeta")
  const addPlanilla = fuelAddDataOptions(session).find((option) => option.kind === "planilla")
  const emptyAction = addCard?.allowed ? { label: "Agregar reporte de tarjeta", href: addCard.href } : undefined
  const originEmptyAction = addPlanilla?.allowed
    ? <Button asChild><Link href={addPlanilla.href}>Agregar planilla de cargas</Link></Button>
    : addCard?.allowed
      ? <Button asChild><Link href={addCard.href}>Agregar reporte de tarjeta</Link></Button>
      : undefined
  const foldHref = (target: FoldSection | null) => searchWith(sp, { seccion: target, pagina: null, ...(target ? {} : { fuente: null, patente: null, asociacion: null, proveedor: null }) })
  const performanceHref = inContext(fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS[PERFORMANCE_FAMILIES[0]]))
  const reviewHref = hrefInContext(fuelInboxHref({ tipo: "carga", faena: filters.worksiteId }), period)
  const exportParams = exportParamsFromFilters(filters)
  const historyParams = exportParamsFromFilters(historyFilters)

  const watch = dashboard.data
    ? buildWatchItems({ alerts: dashboard.data.alerts, rankings: [dashboard.data.topPatentesPorConsumo, dashboard.data.topPatentesPorGasto, dashboard.data.transaccionesPorPatente], limit: 8 })
        .map((item) => ({ ...item, href: item.href ? inContext(item.href) : null }))
    : []

  const loads = header.data
  const excludedTotal = loads ? loads.excludedKm + loads.excludedHours : null
  const litersPct = loads && previousHeader.data ? percentVariation(loads.totalLiters, previousHeader.data.totalLiters) : null
  const change = previous ? variationPhrase(litersPct, previous.inLabel) : null
  const chartCaption = chartWindow.isHistory ? `Últimos ${chartWindow.monthKeys.length} meses, hasta ${period.inLabel}.` : `${period.label}.`
  const noteForOrigins = [
    monthlyGranularityNote(period),
    filters.mandanteId ? "El mandante sólo acota las cargas de equipos: lo informado por tarjetas y lo facturado se mira por faena." : null,
  ].filter(Boolean).join(" ") || null

  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        description="Litros por faena, equipo y origen del combustible"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Litros" }]} />}
        actions={
          <FuelHeaderActions period={period}>
            {canExport && loads && loads.loadCount > 0 ? <ExportButton action={exportOverviewAction} filters={{ params: exportParams, historyParams }} label="Exportar Excel" /> : null}
          </FuelHeaderActions>
        }
      />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ConsumoNav activeKey="litros" />
      <ControlFilters worksites={ctx.worksites} mandantes={ctx.mandantes} />

      {/* La respuesta primero: cuánto se cargó, en cuántos equipos y cómo se compara. */}
      {header.failed || !loads ? null : loads.loadCount > 0 ? (
        <div className="mb-6 max-w-[78ch] space-y-2 text-base text-[var(--color-text)]">
          <p>
            En {period.inLabel} se cargaron <strong className="font-semibold tabular-nums">{formatQty(Math.round(loads.totalLiters))} L</strong> en{" "}
            <strong className="font-semibold tabular-nums">{formatQty(loads.equipmentCount)} {loads.equipmentCount === 1 ? "equipo" : "equipos"}</strong>
            {change ? <>, {change}</> : null}.
          </p>
          {loads.kmPerLiter !== null || loads.litersPerHour !== null ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Rinden en promedio{" "}
              {loads.kmPerLiter !== null ? <strong className="font-semibold tabular-nums text-[var(--color-text)]">{formatQty(loads.kmPerLiter, undefined, { maximumFractionDigits: 2 })} {PERFORMANCE_UNIT_LABELS.km_per_liter}</strong> : null}
              {loads.kmPerLiter !== null && loads.litersPerHour !== null ? " y " : null}
              {loads.litersPerHour !== null ? <strong className="font-semibold tabular-nums text-[var(--color-text)]">{formatQty(loads.litersPerHour, undefined, { maximumFractionDigits: 2 })} {PERFORMANCE_UNIT_LABELS.liters_per_hour}</strong> : null}
              {" "}(equipos con odómetro y con horómetro, por separado).{" "}
              <Link href={performanceHref} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2 hover:no-underline">Ver qué equipos rinden peor</Link>
            </p>
          ) : null}
          {excludedTotal !== null ? <ReviewExclusionNote count={excludedTotal} href={reviewHref} /> : null}
        </div>
      ) : anyLoads.data === false ? (
        <EmptyState
          title="Todavía no hay cargas de equipos para analizar"
          description="Esta pantalla se llena con la planilla de cargas, con las cargas registradas en terreno y con los reportes de tarjeta. Agrega alguno para ver litros, rendimientos y comparaciones."
          action={originEmptyAction}
        />
      ) : (
        <p className="mb-6 max-w-[78ch] text-base text-[var(--color-text-muted)]">En {period.inLabel} no hay cargas de equipos con estos filtros. Prueba con otro período o quita la faena.</p>
      )}

      <div className="mb-10 grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <ViewSection id="litros-por-mes" title="Litros por mes, según de dónde salió" question={`¿Cuánto combustible se cargó cada mes y por qué medio llegó? ${chartCaption}`}>
          {monthly.data ? <OverviewMonthlyChart data={pivotMonthlyByMedium(monthly.data)} /> : <SectionError what="los litros por mes" />}
        </ViewSection>
        <div>
          {origins.data && dashboard.data ? (
            <FuelOriginSummary
              data={origins.data}
              canViewCosts={canViewCosts}
              tct={{ liters: dashboard.data.kpis.totalCantidad, transactions: dashboard.data.kpis.totalTransacciones, vehicles: dashboard.data.kpis.patentesUnicas, cards: dashboard.data.kpis.totalTarjetas, variationLitersPct: dashboard.data.kpis.variacionCantidadPct }}
              hrefs={{
                terreno: inContext(FUEL_PATHS.cargas),
                tarjetas: inContext(FUEL_PATHS.tarjetas),
                facturas: canViewCosts ? inContext(FUEL_PATHS.pagos) : null,
                cuadratura: canViewTae ? inContext(FUEL_PATHS.cuadratura) : null,
              }}
              worksiteHref={(worksiteId) => searchWith(sp, { faena: worksiteId, pagina: null })}
              emptyAction={originEmptyAction}
              tctNote={noteForOrigins}
            />
          ) : (
            <SectionError what="de dónde vino lo cargado" />
          )}
        </div>
      </div>

      <div className="mb-10 grid gap-8 xl:grid-cols-2">
        {([
          { unit: "km_per_liter", id: "serie-km", title: "Kilómetros contra litros", question: "¿Cuántos kilómetros se recorrieron con los litros cargados, mes a mes? Equipos con odómetro.", measureUnit: "km", sums: "Σ km ÷ Σ litros" },
          { unit: "liters_per_hour", id: "serie-horas", title: "Horas contra litros", question: "¿Cuántas horas de motor se trabajaron con los litros cargados, mes a mes? Equipos con horómetro.", measureUnit: "h", sums: "Σ litros ÷ Σ horas" },
        ] as const).map(({ unit, id, title, question, measureUnit, sums }) => {
          const data = series.data?.[unit]
          return (
            <ViewSection key={id} id={id} title={title} question={question}>
              {data ? (
                <div className="grid gap-3">
                  <OverviewMeterChart unit={unit} points={data.points} />
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {data.ratio === null ? (
                      "Todavía no hay tramos con rendimiento calculado en estos meses."
                    ) : (
                      <>
                        Global de estos meses:{" "}
                        <strong className="font-semibold tabular-nums text-[var(--color-text)]">{formatQty(data.ratio, undefined, { maximumFractionDigits: 2 })} {PERFORMANCE_UNIT_LABELS[unit]}</strong>
                        {" "}= {sums} de {formatQty(data.points.reduce((sum, point) => sum + point.segments, 0))} tramos ({formatQty(data.totalMeasure, undefined, { maximumFractionDigits: 0 })} {measureUnit}).
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <SectionError what={unit === "km_per_liter" ? "la serie de kilómetros" : "la serie de horas"} />
              )}
            </ViewSection>
          )
        })}
      </div>

      <ViewSection id="patentes-para-mirar" title="Patentes para mirar" question="Consumo alto, muchas transacciones, sin rendimiento o sin vincular. Un clic abre la ficha del equipo.">
        {dashboard.data ? <ConsumptionWatchList items={watch} /> : <SectionError what="las patentes para mirar" />}
      </ViewSection>

      <div className="mb-10 grid gap-3">
        <UrlFold
          id="tarjetas"
          title="Más análisis de tarjetas"
          description="Tendencia y precio, litros por tipo de equipo, litros contra odómetro y horómetro, evolución por equipo, matriz faena × equipo y rankings por patente."
          open={tarjetasOpen}
          openHref={foldHref("tarjetas")}
          closeHref={foldHref(null)}
        >
          <ConsumptionFiltersBar section="tarjetas" fuentes={sources?.data ?? []} currentFilters={{ fuente, patente, associated }} proveedor={proveedor} />
          {monthlyGranularityNote(period) ? <p className="mb-5 text-sm text-[var(--color-text-muted)]">{monthlyGranularityNote(period)}</p> : null}
          <CardsAnalysis
            dashboard={cardsDashboard.data}
            byEquipmentType={byType?.data ?? []}
            scatter={scatter?.data ?? []}
            evolution={evolution?.data ?? []}
            heatmap={heatmap?.data ?? []}
            canViewCosts={canViewCosts}
            emptyAction={emptyAction}
            periodLabel={period.label}
          />
        </UrlFold>

        <UrlFold
          id="planilla"
          title="Planilla de cargas"
          description="Equipos con mayor gasto, rendimiento declarado en la planilla (km/L y L/h) y consumo por faena y por proveedor."
          open={planillaOpen}
          openHref={foldHref("planilla")}
          closeHref={foldHref(null)}
        >
          <ConsumptionFiltersBar section="planilla" fuentes={[]} currentFilters={{ patente, associated }} proveedor={proveedor} />
          {planilla?.failed ? <SectionError what="los gráficos de la planilla" /> : <PlanillaAnalysis summary={planilla?.data ?? null} canViewCosts={canViewCosts} />}
        </UrlFold>

        <UrlFold
          id="faena-medio"
          title="Faena × medio de suministro"
          description="Litros de cada faena según de dónde llegó el combustible, separados en equipos con odómetro y con horómetro; con totales y Excel."
          open={faenaMedioOpen}
          openHref={foldHref("faena-medio")}
          closeHref={foldHref(null)}
        >
          <WorksiteMedium
            crosstabs={{ km_per_liter: crosstabs?.[0]?.data ?? null, liters_per_hour: crosstabs?.[1]?.data ?? null }}
            exportParams={exportParams}
            canExport={canExport}
          />
        </UrlFold>
      </div>
    </PageContainer>
  )
}
