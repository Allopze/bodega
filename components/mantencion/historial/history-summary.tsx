import { CaretDown } from "@phosphor-icons/react/dist/ssr"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { WorkTypeChart } from "@/app/(app)/mantencion/panel/indicators-charts-lazy"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { historyHref, type HistoryParams } from "@/lib/mantencion/history-view"
import type { MaintenanceWorkSummary } from "@/lib/services/mantencion/maintenance-work"
import { cn, formatDate, formatPercent, formatQty } from "@/lib/utils"

/**
 * El resumen encima de la lista del Historial de mantenciones: tres cifras en una tira, dos gráficos (trabajos por
 * tipo y equipos con más correctivas) y una línea de apoyo. Es una lista con resumen, no un tablero (regla 7 de
 * `app/AGENTS.md`): la tarjeta es blanca y las cifras van en la tira, sin tiles. Los conteos por tipo no se repiten
 * aquí: el tipo ya se elige en el selector de la página (A5).
 *
 * Server component: sólo importa los wrappers diferidos (`BarRankingChartLazy`, `WorkTypeChart`), que reciben
 * props serializables. El `summary` lo calcula la página con `summarizeMaintenanceWork` sobre las filas ya filtradas,
 * con una serie mensual.
 */

/** Cifra de «Horas hombre» o «Días en taller»: con «N sin dato» si algún trabajo no la trae. */
function dataStat(key: string, label: string, data: { total: number; withData: number; withoutData: number }): SummaryStat {
  // Sin ningún dato, la palabra «Sin dato» ya lo dice: no se pone una cifra inventada.
  const value: SummaryStat = data.withData === 0
    ? { key, label, value: "Sin dato", valueKind: "text" }
    : { key, label, value: data.total }
  return data.withoutData > 0 ? { ...value, secondary: `${formatQty(data.withoutData)} sin dato` } : value
}

/**
 * De dónde salen las cifras, con las fechas del corte (la misma regla que el Panel). Si la vista filtra por origen,
 * la fuente es sólo ese origen.
 */
function sourceText(params: HistoryParams, includesOrders: boolean): string {
  const forms = `formularios (hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)})`
  const records = `registros firmados (desde el ${formatDate(FORMS_CUTOVER_DATE)})`
  if (params.source === "historial") return forms
  if (params.source === "registro") return records
  if (params.source === "ot") return "órdenes de trabajo que entraron a taller"
  return includesOrders ? `${forms}, órdenes de trabajo y ${records}` : `${forms} y ${records}`
}

export function HistorySummary({ summary, params, scopeNote, includesOrders }: {
  summary: MaintenanceWorkSummary
  /** Para armar los enlaces con `historyHref`: el ranking conserva los demás filtros de la vista. */
  params: HistoryParams
  /** Alcance ya dicho por la página («Todas las faenas», «Cholguán»). */
  scopeNote: string
  /** `false`: quien mira no ve las órdenes de trabajo; se dice en una línea. */
  includesOrders: boolean
}) {
  const seriesTotal = summary.series.reduce((sum, point) => sum + point.preventiva + point.correctiva + point.predictiva + point.sin_clasificar, 0)
  // Sin trabajos en el período ni en la serie, la página muestra su propio estado vacío.
  if (summary.total === 0 && seriesTotal === 0) return null

  const { byType, classified, correctivePercent, laborHours, workshopDays } = summary
  const stats: SummaryStat[] = [
    { key: "trabajos", label: "Trabajos", value: summary.total },
    dataStat("horas", "Horas hombre", laborHours),
    dataStat("dias", "Días en taller", workshopDays),
  ]

  const source = sourceText(params, includesOrders)
  const description = `${scopeNote} · Fuente: ${source}`

  // Un gráfico sin ningún trabajo por tipo no se dibuja (igual que `WorkTypeChart`, que devuelve null).
  const hasWorkChart = summary.series.some((point) => point.preventiva + point.correctiva + point.predictiva + point.sin_clasificar > 0)
  const workChart = hasWorkChart
    // La serie es mensual: la página la calcula con granularidad `month`.
    ? <WorkTypeChart data={summary.series} granularity="month" scopeNote={scopeNote} source={source} />
    : null

  const corrective = summary.topCorrective
  const top = corrective[0]
  const topTies = top ? corrective.filter((row) => row.count === top.count).length : 0
  const rankingChart = top ? (
    <ChartFrame
      title="Equipos con más correctivas"
      description={`${description}; sólo equipos con 2 o más`}
      headline={
        <>
          <ChartHeadlineValue>{formatQty(top.count)}</ChartHeadlineValue>
          <ChartHeadlineCaption>
            {topTies === 1
              ? `correctivas en ${top.label}, el equipo con más`
              : `equipos empatan con ${formatQty(top.count)} correctivas`}
          </ChartHeadlineCaption>
        </>
      }
    >
      <BarRankingChartLazy
        ariaLabel="Equipos con más trabajos correctivos"
        unit=" correctivas"
        order="desc"
        limit={8}
        items={corrective.map((row) => ({
          key: row.vehicleId,
          label: row.label,
          value: row.count,
          // Filtra el historial a ese equipo y conserva los demás filtros de la vista.
          href: historyHref(params, { vehicleId: row.vehicleId, view: "historial" }),
        }))}
      />
      <ChartDataTable
        caption="Equipos con más correctivas"
        headers={["Equipo", "Correctivas"]}
        rows={corrective.map((row) => [row.label, row.count])}
      />
    </ChartFrame>
  ) : null

  const correctivesLine = correctivePercent === null
    ? "Correctivas: Sin dato · ningún trabajo clasificado por tipo"
    : `Correctivas: ${formatPercent(correctivePercent, 0)} de los trabajos clasificados (${formatQty(byType.correctiva)} de ${formatQty(classified)})`
  const unclassified = byType.sin_clasificar > 0 ? ` · ${formatQty(byType.sin_clasificar)} sin clasificar aparte` : ""

  const hasCharts = workChart !== null || rankingChart !== null
  // El titular de «Trabajos por tipo» ya dice el % de correctivas y lo que quedó sin clasificar: la línea de apoyo sólo
  // lo repite cuando ese gráfico no se dibuja (A5: una cifra, una representación).
  const showCorrectives = workChart === null
  const showFooter = showCorrectives || !includesOrders

  return (
    <section aria-label="Resumen del historial" className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs">
      <SummaryBar stats={stats} />
      {hasCharts && (
        // Abiertos por defecto; quien quiere la lista a la vista los pliega.
        <details open className="group border-t border-[var(--color-border)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] [&::-webkit-details-marker]:hidden">
            <span>Gráficos del período</span>
            <CaretDown aria-hidden size={14} weight="bold" className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid border-t border-[var(--color-border)] xl:grid-cols-2">
            {workChart && <div className="min-w-0">{workChart}</div>}
            {rankingChart && (
              <div className={cn("min-w-0", workChart && "border-t border-[var(--color-border)] xl:border-l xl:border-t-0")}>{rankingChart}</div>
            )}
          </div>
        </details>
      )}
      {showFooter && (
        <div className={cn("space-y-1 px-5 py-3 text-xs text-[var(--color-text-muted)]", "border-t border-[var(--color-border)]")}>
          {showCorrectives && <p>{`${correctivesLine}${unclassified}`}</p>}
          {!includesOrders && <p>Tu perfil no ve todas las órdenes de trabajo: las cifras son de formularios y registros.</p>}
        </div>
      )}
    </section>
  )
}
