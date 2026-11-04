import { ChartSection } from "@/components/charts/chart-section"
import { MonthlyTrendChart, type MonthlyTrendPoint } from "@/components/charts/monthly-trend-chart"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatPercent } from "@/lib/utils"
import {
  PPA_RATE_MIN_SAMPLE,
  ppaMonthNote,
  ppaTrendDataTable,
  summarizePpaTrend,
  type PpaMonthPoint,
  type PpaWorksiteRanking,
} from "@/lib/ppa/detention-rate"

/**
 * Los gráficos del PPA (CHART-011 de `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Tres bloques que antes eran un `RankPanel` local (tres copias de la misma barra
 * hecha a mano) y que ahora usan los primitivos compartidos:
 *
 * - `PpaTrendSection`: PPA recibidos por mes (columnas grises, la referencia) y
 *   la tasa de detención (línea de marca, eje derecho). La tasa se corta en los
 *   meses sin base suficiente y el tooltip dice cuántos PPA hay.
 * - `PpaWorksiteRateSection`: `RankedList` de la TASA de detención por faena, con
 *   la base de cada una. Las faenas con pocos PPA se nombran aparte como «datos
 *   insuficientes»: ordenar por conteo castigaba a la que más PPA llena.
 * - `PpaCountRankingSection`: los rankings de conteo (motivos de alerta, tareas).
 */

export function PpaTrendSection({ points, className }: { points: PpaMonthPoint[]; className?: string }) {
  if (!points.some((point) => point.total > 0)) return null

  const data: MonthlyTrendPoint[] = points.map((point) => ({
    month: point.month,
    partial: point.partial,
    values: { total: point.total },
    rate: point.rate.sufficient ? point.rate.percent : null,
    note: ppaMonthNote(point),
  }))

  return (
    <ChartSection
      title="Tasa de detención por mes"
      summary={summarizePpaTrend(points)}
      data={{ caption: "PPA y tasa de detención por mes", ...ppaTrendDataTable(points) }}
      className={className}
    >
      <MonthlyTrendChart
        data={data}
        bars={[{ key: "total", label: "PPA recibidos", color: CHART_COLORS.neutral }]}
        line={{ label: "Tasa de detención", color: CHART_COLORS.brand }}
        ariaLabel="PPA recibidos y tasa de detención por mes"
      />
    </ChartSection>
  )
}

export function PpaWorksiteRateSection({ ranking, className }: { ranking: PpaWorksiteRanking; className?: string }) {
  if (ranking.items.length === 0 && ranking.insufficient.length === 0) return null

  const insufficientNote = ranking.insufficient.length > 0 && (
    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
      Datos insuficientes (menos de {PPA_RATE_MIN_SAMPLE} PPA, sin tasa):{" "}
      {ranking.insufficient.map((worksite) => `${worksite.label} (${worksite.n})`).join(", ")}.
    </p>
  )

  if (ranking.items.length === 0) {
    return (
      <ChartSection
        title="Tasa de detención por faena"
        className={className}
        empty={{
          label: "Ninguna faena tiene PPA suficientes para comparar",
          hint: `Una tasa necesita al menos ${PPA_RATE_MIN_SAMPLE} PPA por faena en los últimos 12 meses; con menos, un solo caso mueve la tasa más de ${Math.floor(100 / PPA_RATE_MIN_SAMPLE)} puntos. Hoy: ${ranking.insufficient.map((worksite) => `${worksite.label} ${worksite.n}`).join(", ")}.`,
        }}
      />
    )
  }

  const top = [...ranking.items].sort((left, right) => right.value - left.value)[0]!
  const items: RankedListItem[] = ranking.items.map((item) => ({ key: item.key, label: item.label, value: item.value, detail: item.detail }))
  return (
    <ChartSection
      title="Tasa de detención por faena"
      summary={`Últimos 12 meses. La más alta es ${top.label}, con ${top.detail}.`}
      data={{
        caption: "Tasa de detención por faena",
        headers: ["Faena", "Tasa de detención", "Base"],
        rows: [
          ...ranking.items.map((item) => [item.label, formatPercent(item.value, 1), item.detail] as Array<string | number>),
          ...ranking.insufficient.map((worksite) => [worksite.label, "Datos insuficientes", `${worksite.n} PPA`] as Array<string | number>),
        ],
      }}
      className={className}
    >
      <RankedList items={items} format="percent" showShare={false} ariaLabel="Tasa de detención por faena" />
      {insufficientNote}
    </ChartSection>
  )
}

export function PpaCountRankingSection({
  title,
  ariaLabel,
  items,
  className,
}: {
  title: string
  ariaLabel: string
  items: RankedListItem[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ChartSection title={title} className={className}>
      <RankedList items={items} format="count" ariaLabel={ariaLabel} />
    </ChartSection>
  )
}
