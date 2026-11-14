import type { ReactNode } from "react"
import type { Session } from "next-auth"
import Link from "next/link"
import { GasPump, Gauge, Receipt, Truck } from "@phosphor-icons/react/dist/ssr"
import { CoverageNotice } from "@/components/charts/coverage-notice"
import { Button } from "@/components/ui/button"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot, DASHBOARD_KPI } from "@/components/ui/dashboard-panel"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { can } from "@/lib/auth/can"
import { PERFORMANCE_FAMILY_SLUGS } from "@/lib/combustibles/control/contracts"
import { getLitersByMonthAndMedium, hasAnyLoads } from "@/lib/combustibles/control/queries/overview"
import { controlFiltersFromPeriod } from "@/lib/combustibles/control/queries/period-filters"
import { pivotMonthlyByMedium } from "@/lib/combustibles/control/view-helpers"
import { coverageNoticeText, fuelSourcesHref } from "@/lib/combustibles/coverage-notice"
import { getFuelProviderCoverageGaps } from "@/lib/combustibles/coverage-notice-data"
import { getLedgerTrend } from "@/lib/combustibles/indicators/ledger"
import { getIndicatorFigures, getLitersByEquipmentType, getLitersByWorksite } from "@/lib/combustibles/indicators/queries"
import {
  equipmentCount,
  indicatorWindows,
  ledgerChartPoints,
  ledgerCost,
  assignSpans,
  costPriceTable,
  ledgerHasCost,
  mediumTable,
  priceHeadline,
  priceSummary,
  topShare,
  windowCaption,
} from "@/lib/combustibles/indicators/view"
import { buildPanelFigures, variationLabel, type PanelFigure } from "@/lib/combustibles/panel/figures"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS, fuelPerformanceHref } from "@/lib/combustibles/routes"
import { formatCLP, formatQty } from "@/lib/utils"
import { hrefInContext } from "../consumo/_components/page-links"
import { createSourceTracker } from "../consumo/_components/track-sources"
import { BlockError, ChartBlock, RankingBlock } from "./indicator-blocks"
import { CostPriceChart, LitersByMediumChart } from "./indicators-charts-lazy"

const CONSUMO_LITROS_TARJETAS = `${FUEL_PATHS.consumoLitros}?seccion=tarjetas`

/** Un tile de litros o de rendimiento desde las cifras del Panel: sin dato dice qué falta, nunca un cero. */
function figureTile({ figure, label, detail, icon, href, trendPolarity }: {
  figure: PanelFigure
  label: string
  detail: string
  icon: ReactNode
  href: string
  trendPolarity: "up-good" | "up-bad" | "neutral"
}) {
  if (figure.value === null) {
    return <KpiCard {...DASHBOARD_KPI} icon={icon} label={label} value="—" detail="" href={href} empty={{ message: figure.emptyHint, actionLabel: "Ver el detalle" }} />
  }
  return (
    <KpiCard
      {...DASHBOARD_KPI}
      icon={icon}
      label={label}
      value={`${figure.value} ${figure.unit}`}
      detail={detail}
      trend={figure.variation?.pct ?? null}
      trendPolarity={trendPolarity}
      trendLabel={figure.variation ? variationLabel(figure.variation) : undefined}
      href={href}
    />
  )
}

/**
 * «Consumo»: cuánto se cargó, cuánto costó, cómo rinden camiones y maquinaria y de dónde
 * viene lo cargado. Cada consulta cae por separado: si una falla, sólo su bloque lo dice.
 *
 * Fuentes (el mismo origen que la pantalla de Consumo que cada cifra enlaza):
 * - Tiles de litros y rendimiento: cargas de equipos, las del Panel (`getIndicatorFigures`).
 * - Costo y gráfico «Litros y costo»: libro del proveedor (`getLedgerTrend`), mensual.
 * - «Por medio», «por faena» y «por tipo de equipo»: cargas de equipos, como los tiles.
 */
export async function ConsumoSection({ session, period, worksiteId }: { session: Session; period: ResolvedFuelPeriod; worksiteId?: string }) {
  const windows = indicatorWindows(period)
  const filters = controlFiltersFromPeriod(period, worksiteId ? { faena: worksiteId } : {})
  // Rankings por día civil de Chile, igual que los tiles (que cortan por día): así suman lo mismo que el tile de litros.
  const dayFilters = { ...filters, months: [] as number[], from: period.from, to: period.to }
  const historyFilters = { ...filters, year: Number(windows.chart.from.slice(0, 4)), months: [] as number[], from: windows.chart.from, to: windows.chart.to }
  const canViewCosts = can(session, "combustibles:view") && can(session, "combustibles:view_costs")
  const canExport = can(session, "combustibles:export")
  const sourcesHref = fuelSourcesHref(session)

  const { track, degraded, total } = createSourceTracker("combustibles/indicadores/consumo")
  const [figuresRaw, ledger, monthly, byWorksite, byType, coverage, anyLoads] = await Promise.all([
    track(getIndicatorFigures(session, period, { worksiteId }), null, "cifras del período"),
    // Sin `view_costs` el libro no se dibuja en ninguna parte: no se consulta ni entra al aviso de degradados.
    canViewCosts
      ? track(getLedgerTrend(session, { lastMonth: windows.ledgerLastMonth, months: windows.ledgerMonths, worksiteId }), null, "libro del proveedor")
      : Promise.resolve({ data: null, failed: false }),
    track(getLitersByMonthAndMedium(session, historyFilters), null, "litros por mes y medio"),
    track(getLitersByWorksite(session, dayFilters), null, "litros por faena"),
    track(getLitersByEquipmentType(session, dayFilters), null, "litros por tipo de equipo"),
    track(getFuelProviderCoverageGaps(session, windows.chart.monthKeys, { worksiteId }), { gapMonths: [], partialMonths: [] }, "cobertura del proveedor"),
    track(hasAnyLoads(session), true, "cargas en el alcance"),
  ])

  const withPeriod = (href: string, faena = worksiteId) => hrefInContext(href, period, faena)
  const figures = figuresRaw.data ? buildPanelFigures(figuresRaw.data, period) : null
  const cost = ledger.data ? ledgerCost(ledger.data, period, windows.previous) : null
  const caption = windowCaption(windows.chart, period)

  const ledgerPoints = ledger.data ? ledgerChartPoints(ledger.data, windows.chart.monthKeys) : []
  const mediumData = monthly.data ? pivotMonthlyByMedium(monthly.data) : null
  const worksiteRows = byWorksite.data ?? []
  const typeRows = byType.data ?? []

  // Sin nada que mostrar y sin consultas caídas, un solo estado vacío con la acción para llenarlo (A4).
  const nothing = !degraded.length
    && (figures?.empty ?? true)
    && !(canViewCosts && ledgerHasCost(ledgerPoints))
    && (mediumData?.points.length ?? 0) === 0
    && worksiteRows.length === 0

  const coverageInput = {
    gapMonths: coverage.data.gapMonths,
    partialMonths: coverage.data.partialMonths,
    subject: "los litros y el costo del libro de Copec",
  }
  const coverageNote = coverageNoticeText(coverageInput)
  const excel = canExport ? { permission: "combustibles:export" as const, notes: coverageNote ? [coverageNote] : [] } : undefined
  // Con costos a la vista, el Excel de «Ver datos» exige además el permiso de exportar montos.
  const excelWithCosts = excel && (!canViewCosts || can(session, "combustibles:export_sensitive")) ? excel : undefined

  const links = [
    { label: "Panel de combustible", href: withPeriod(FUEL_PATHS.panel) },
    { label: "Consumo", href: withPeriod(FUEL_PATHS.consumoLitros) },
    { label: "Cargas", href: withPeriod(FUEL_PATHS.cargas) },
  ]

  if (nothing) {
    const hasLoadsElsewhere = anyLoads.data
    return (
      <>
        <DashboardSection
          id="consumo"
          title="Consumo"
          links={links}
          charts={
            <ChartSlot span="full">
              <EmptyState
                compact
                as="p"
                title={hasLoadsElsewhere ? `Sin cargas en ${period.inLabel}` : "Todavía no hay datos de combustible para mostrar"}
                description={hasLoadsElsewhere
                  ? "No hay cargas de equipos en este período con estos filtros. Prueba con otro período o quita la faena."
                  : "Los indicadores se llenan con las cargas registradas en terreno, la planilla de cargas y los reportes de tarjeta. Agrega alguno para ver litros, costo y rendimiento."}
                action={sourcesHref ? <Button asChild><Link href={withPeriod(sourcesHref)}>Ir a Fuentes de datos</Link></Button> : undefined}
              />
            </ChartSlot>
          }
        />
      </>
    )
  }

  const litersTop = topShare(worksiteRows.map((row) => ({ label: row.name, value: row.liters })))
  const typeTop = topShare(typeRows.map((row) => ({ label: row.name, value: row.liters })))
  const mediumTop = mediumData
    ? topShare(mediumData.series.map((item) => ({ label: item.label, value: mediumData.points.reduce((sum, point) => sum + Number(point[item.key] ?? 0), 0) })))
    : null
  const showWorksiteRanking = worksiteRows.length > 1
  const priceHead = priceHeadline(priceSummary(ledger.data ?? [], windows.chart.monthKeys))

  // Qué gráficos ocupan celda (con datos o con su aviso de error) y, según cuántos sean, el ancho de cada uno:
  // así no quedan filas a medias en `xl` (2 columnas) ni en `2xl` (3). El costo sólo con `view_costs`.
  const [costSpan, mediumSpan, worksiteSpan, typeSpan] = assignSpans([
    canViewCosts && (ledger.failed || ledgerHasCost(ledgerPoints)),
    monthly.failed || (mediumData?.points.length ?? 0) > 0,
    byWorksite.failed || showWorksiteRanking,
    byType.failed || typeRows.length > 0,
  ])

  return (
    <>
      <DegradedDataBanner degraded={degraded} total={total()} />
      <DashboardSection
        id="consumo"
        title="Consumo"
        links={links}
        note={canViewCosts && !period.isWholeMonths ? "El costo viene del libro de Copec, que es mensual: se toman los meses completos que toca el período." : undefined}
        coverage={<CoverageNotice {...coverageInput} sourcesHref={sourcesHref ? withPeriod(sourcesHref) : undefined} />}
        kpis={
          <>
            {figures ? figureTile({
              figure: figures.liters,
              label: "Litros cargados",
              detail: `${equipmentCount(figures.equipmentCount)} · ${figures.liters.hint ?? period.label}`,
              icon: <GasPump size={16} />,
              // Sin cargas el tile lleva a donde se cargan; con cargas, al detalle de litros.
              href: withPeriod(figures.liters.value === null ? FUEL_PATHS.cargas : FUEL_PATHS.consumoLitros),
              trendPolarity: "neutral",
            }) : null}
            {canViewCosts && ledger.data && cost ? (
              cost.amount === null ? (
                <KpiCard {...DASHBOARD_KPI} icon={<Receipt size={16} />} label="Costo del libro de Copec" value="—" detail="" href={withPeriod(CONSUMO_LITROS_TARJETAS)}
                  empty={{ message: "Sin datos del proveedor en este período", actionLabel: "Ver el detalle" }} />
              ) : (
                <KpiCard
                  {...DASHBOARD_KPI}
                  icon={<Receipt size={16} />}
                  label="Costo del libro de Copec"
                  value={formatCLP(cost.amount)}
                  detail={period.label}
                  trend={cost.pct}
                  trendPolarity="up-bad"
                  trendLabel={windows.previous ? `vs. ${windows.previous.inLabel}` : undefined}
                  href={withPeriod(CONSUMO_LITROS_TARJETAS)}
                />
              )
            ) : null}
            {figures ? figureTile({
              figure: figures.trucks,
              label: "Camiones · km/L",
              detail: figures.trucks.hint ?? period.label,
              icon: <Truck size={16} />,
              href: withPeriod(fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS.camiones)),
              trendPolarity: "up-good",
            }) : null}
            {figures ? figureTile({
              figure: figures.machinery,
              label: "Maquinaria · L/h",
              detail: figures.machinery.hint ?? period.label,
              icon: <Gauge size={16} />,
              href: withPeriod(fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS.maquinaria)),
              trendPolarity: "up-bad",
            }) : null}
          </>
        }
        charts={
          <>
            {costSpan === null ? null : ledger.failed ? <BlockError what="el costo por mes" span={costSpan} /> : (
              <ChartSlot span={costSpan}>
                <CostPriceChart
                  data={ledgerPoints}
                  windowLabel={caption}
                  headline={priceHead}
                  footer={(
                    <ChartDataTable
                      caption="Costo y precio por litro por mes, libro de Copec"
                      {...costPriceTable(ledgerPoints)}
                      excel={excelWithCosts}
                    />
                  )}
                />
              </ChartSlot>
            )}
            {mediumSpan === null ? null : monthly.failed || !mediumData ? <BlockError what="los litros por medio de suministro" span={mediumSpan} /> : (
              <ChartBlock
                span={mediumSpan}
                title="Litros por medio de suministro"
                description={`${caption} · cargas de equipos, terreno y planilla`}
                headline={mediumTop ? { value: `${formatQty(mediumTop.sharePct, undefined, { maximumFractionDigits: 0 })} %`, caption: `de los litros llegó por ${mediumTop.label}` } : undefined}
                table={{ caption: "Litros por mes y medio de suministro", ...mediumTable(mediumData), excel }}
              >
                <LitersByMediumChart data={mediumData} />
              </ChartBlock>
            )}
            {worksiteSpan === null ? null : byWorksite.failed ? <BlockError what="los litros por faena" span={worksiteSpan} /> : (
              <RankingBlock
                span={worksiteSpan}
                title="Litros por faena"
                description={`${period.label} · cargas de equipos · un clic abre Consumo de esa faena`}
                headline={litersTop ? { value: `${formatQty(litersTop.sharePct, undefined, { maximumFractionDigits: 0 })} %`, caption: `de los litros salió de ${litersTop.label}` } : undefined}
                ariaLabel="Litros por faena en el período"
                items={worksiteRows.map((row) => ({
                  key: row.worksiteId,
                  label: row.name,
                  value: row.liters,
                  detail: equipmentCount(row.equipment),
                  href: withPeriod(FUEL_PATHS.consumoLitros, row.worksiteId),
                }))}
              />
            )}
            {typeSpan === null ? null : byType.failed ? <BlockError what="los litros por tipo de equipo" span={typeSpan} /> : (
              <RankingBlock
                span={typeSpan}
                title="Litros por tipo de equipo"
                description={`${period.label} · cargas de equipos`}
                headline={typeTop ? { value: `${formatQty(typeTop.sharePct, undefined, { maximumFractionDigits: 0 })} %`, caption: `de los litros lo cargaron ${typeTop.label.toLowerCase()}` } : undefined}
                ariaLabel="Litros por tipo de equipo en el período"
                items={typeRows.map((row) => ({ key: row.typeId ?? "_none", label: row.name, value: row.liters, detail: equipmentCount(row.equipment) }))}
              />
            )}
          </>
        }
      />
    </>
  )
}
