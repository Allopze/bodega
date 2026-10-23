import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { GasPump } from "@phosphor-icons/react/dist/ssr"
import { requirePermission, can } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES } from "@/lib/combustibles/control/contracts"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import { getLitersByMonthAndMedium, getMeterSeries, getOverviewHeader, getWorksiteMediumCrosstab, hasAnyLoads } from "@/lib/combustibles/control/queries/overview"
import { pickControlParams, pivotMonthlyByMedium, revisionHref } from "@/lib/combustibles/control/view-helpers"
import { formatQty } from "@/lib/utils"
import { ConsumoNav } from "../consumo-nav"
import { ControlFilters } from "./_components/control-filters"
import { loadControlContext } from "./_components/control-context"
import { OverviewMeterChart, OverviewMonthlyChart, OverviewRankingChart } from "./_charts/overview-charts-lazy"
import { OverviewCrosstab } from "./_charts/overview-crosstab"
import { ViewSection, SectionError } from "./_charts/overview-section"
import { ReviewExclusionNote } from "./_charts/performance-review-note"
import { exportCrosstabAction, exportOverviewAction } from "./export-overview-actions"

export const metadata: Metadata = { title: "Cargas por equipo" }

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const RANKING_LIMIT = 12
const ratio = (value: number | null) => (value === null ? "—" : formatQty(value, undefined, { maximumFractionDigits: 2 }))

export default async function ControlOverviewPage({ searchParams }: PageProps) {
  let session
  try {
    session = await requirePermission("combustibles:view", "/combustibles/control")
  } catch {
    redirect("/forbidden")
  }

  const sp = await searchParams
  const filters = parseControlFilters(sp)
  const exportParams = pickControlParams(sp)
  const canExport = can(session, "combustibles:export")
  const canImport = can(session, "combustibles:import")

  // Cada consulta falla por separado: el widget muestra su error y el resto de la vista sigue viva.
  const failed: string[] = []
  const sources: string[] = []
  const track = <T,>(promise: Promise<T>, label: string): Promise<T | null> => {
    sources.push(label)
    return promise.catch((error: unknown) => {
      logger.error(`[combustibles/control] ${label} falló`, error)
      failed.push(label)
      return null
    })
  }

  const [ctx, header, monthly, crossKm, crossHours, series, anyLoads] = await Promise.all([
    loadControlContext(session),
    track(getOverviewHeader(session, filters), "header"),
    track(getLitersByMonthAndMedium(session, filters), "monthly"),
    track(getWorksiteMediumCrosstab(session, filters, "km_per_liter"), "crosstab-km"),
    track(getWorksiteMediumCrosstab(session, filters, "liters_per_hour"), "crosstab-hours"),
    track(getMeterSeries(session, filters), "series"),
    track(hasAnyLoads(session), "any-loads"),
  ])

  const reviewHref = revisionHref(filters)
  const exportAction = canExport ? (
    <ExportButton action={exportOverviewAction} filters={{ params: exportParams }} label="Exportar vista general" />
  ) : undefined

  const stats: SummaryStat[] = [
    {
      key: "litros",
      label: "Litros en el período",
      value: header ? formatQty(header.totalLiters, undefined, { maximumFractionDigits: 0 }) : "—",
      valueKind: header ? "number" : "text",
      secondary: header ? `${formatQty(header.loadCount)} cargas` : "No se pudo calcular",
      href: "#litros-por-mes",
    },
    {
      key: "km",
      label: "Rendimiento global (km/L)",
      value: ratio(header?.kmPerLiter ?? null),
      valueKind: header?.kmPerLiter != null ? "number" : "text",
      secondary: header?.kmPerLiter != null ? "Σ km ÷ Σ litros, equipos con odómetro" : "Sin tramos calculados",
      href: "#serie-km",
    },
    {
      key: "horas",
      label: "Consumo global (L/h)",
      value: ratio(header?.litersPerHour ?? null),
      valueKind: header?.litersPerHour != null ? "number" : "text",
      secondary: header?.litersPerHour != null ? "Σ litros ÷ Σ horas, equipos con horómetro" : "Sin tramos calculados",
      href: "#serie-horas",
    },
    {
      key: "revision",
      label: "Cargas en revisión",
      value: header ? header.flaggedCount : "—",
      valueKind: header ? "number" : "text",
      tone: "signal",
      secondary: header && header.flaggedCount === 0 ? "Nada pendiente con estos filtros" : "No entran a promedios",
      href: reviewHref,
    },
  ]

  const noLoadsAtAll = anyLoads === false

  return (
    <PageContainer>
      <PageHeader
        title="Cargas por equipo"
        description="Cuánto combustible se carga, dónde y con qué rendimiento."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento", href: "/combustibles" }, { label: "Cargas por equipo" }]}
        actions={exportAction}
      />
      <DegradedDataBanner degraded={failed} total={sources.length} />
      <ConsumoNav activeKey="equipos" />
      <ControlFilters years={ctx.years} defaultYear={ctx.defaultYear} worksites={ctx.worksites} mandantes={ctx.mandantes} />

      {noLoadsAtAll ? (
        <EmptyState
          icon={<GasPump size={24} aria-hidden />}
          title="Todavía no hay cargas de equipos para analizar"
          description="Esta vista se llena con la planilla de cargas por transacción y con las cargas registradas en terreno. Importa una planilla para ver litros, rendimientos y comparaciones."
          action={canImport ? <Button asChild><Link href="/combustibles/control/importar">Importar planilla de cargas</Link></Button> : undefined}
        />
      ) : (
        <>
          <SummaryBar stats={stats} className="mb-10" />

          <ViewSection id="litros-por-mes" title="Litros por mes" question="¿Cuánto combustible se cargó cada mes y por qué medio de suministro llegó?">
            {monthly ? <OverviewMonthlyChart data={pivotMonthlyByMedium(monthly)} /> : <SectionError what="los litros por mes" />}
          </ViewSection>

          {([
            { unit: "km_per_liter", id: "faenas-km", title: "Faenas con equipos de odómetro", crosstab: crossKm },
            { unit: "liters_per_hour", id: "faenas-horas", title: "Faenas con equipos de horómetro", crosstab: crossHours },
          ] as const).map(({ unit, id, title, crosstab }) => (
            <ViewSection
              key={id}
              id={id}
              title={`${title} (${PERFORMANCE_UNIT_LABELS[unit]})`}
              question={`¿Qué faenas consumen más y por qué medio? Litros de equipos que miden su rendimiento en ${PERFORMANCE_UNIT_LABELS[unit]}.`}
              actions={canExport && crosstab ? (
                <ExportButton action={exportCrosstabAction} filters={{ params: exportParams, unit }} label="Exportar Excel" />
              ) : undefined}
            >
              {crosstab ? (
                <div className="grid gap-6">
                  <OverviewRankingChart
                    items={crosstab.rows.slice(0, RANKING_LIMIT).map((row) => ({ name: row.worksiteName, liters: row.total }))}
                    unitLabel={PERFORMANCE_UNIT_LABELS[unit]}
                  />
                  {crosstab.rows.length > RANKING_LIMIT ? (
                    <p className="-mt-3 text-xs text-[var(--color-text-muted)]">El gráfico muestra las {RANKING_LIMIT} faenas con más litros; la tabla las trae todas.</p>
                  ) : null}
                  <OverviewCrosstab
                    crosstab={crosstab}
                    label={`Litros por faena y medio de suministro, equipos en ${PERFORMANCE_UNIT_LABELS[unit]}`}
                    emptyText={`No hay cargas de equipos en ${PERFORMANCE_UNIT_LABELS[unit]} con estos filtros. Prueba con el año completo o sin faena.`}
                  />
                </div>
              ) : (
                <SectionError what="los litros por faena y medio" />
              )}
            </ViewSection>
          ))}

          {([
            { unit: "km_per_liter", id: "serie-km", title: "Kilómetros contra litros", question: "¿Cuántos kilómetros se recorrieron con los litros cargados, mes a mes?", measureUnit: "km", excluded: header?.excludedKm },
            { unit: "liters_per_hour", id: "serie-horas", title: "Horas contra litros", question: "¿Cuántas horas de motor se trabajaron con los litros cargados, mes a mes?", measureUnit: "h", excluded: header?.excludedHours },
          ] as const).map(({ unit, id, title, question, measureUnit, excluded }) => {
            const data = series?.[unit]
            return (
              <ViewSection key={id} id={id} title={title} question={question}>
                {data ? (
                  <div className="grid gap-3">
                    <OverviewMeterChart unit={unit} points={data.points} />
                    <p className="text-sm text-[var(--color-text-muted)]" title={PERFORMANCE_UNIT_TITLES[unit]}>
                      {data.ratio === null ? (
                        "Todavía no hay tramos con rendimiento calculado para este período."
                      ) : (
                        <>
                          Global del período:{" "}
                          <strong className="font-semibold tabular-nums text-[var(--color-text)]">{ratio(data.ratio)} {PERFORMANCE_UNIT_LABELS[unit]}</strong>
                          {" "}= {unit === "km_per_liter" ? "Σ km ÷ Σ litros" : "Σ litros ÷ Σ horas"} de{" "}
                          {formatQty(data.points.reduce((sum, point) => sum + point.segments, 0))} tramos ({formatQty(data.totalMeasure, undefined, { maximumFractionDigits: 0 })} {measureUnit}).
                        </>
                      )}
                    </p>
                    {excluded !== undefined ? <ReviewExclusionNote count={excluded} href={reviewHref} /> : null}
                  </div>
                ) : (
                  <SectionError what={unit === "km_per_liter" ? "la serie de kilómetros" : "la serie de horas"} />
                )}
              </ViewSection>
            )
          })}
        </>
      )}
    </PageContainer>
  )
}
