import { ChartSection } from "@/components/charts/chart-section"
import { MonthlyTrendChart, type MonthlyTrendPoint } from "@/components/charts/monthly-trend-chart"
import { CHART_COLORS } from "@/lib/chart-palette"
import {
  alcotestTrendDataTable,
  summarizeAlcotestTrend,
  type AlcotestTrendPoint,
} from "@/lib/prevention/alcotest-trend"

/**
 * Controles de alcotest por mes (CHART-010, mitad alcotest): columnas apiladas,
 * negativos abajo y positivos arriba en rojo, para que el positivo se vea sin
 * leer. Sólo conteos agregados: ni el gráfico ni su «Ver datos» nombran a nadie.
 *
 * Sin ningún control no se dibuja: «Controles recientes» ya explica el vacío.
 */
export function AlcotestTrendSection({ points, className }: { points: AlcotestTrendPoint[]; className?: string }) {
  if (!points.some((point) => point.total > 0)) return null

  const data: MonthlyTrendPoint[] = points.map((point) => ({
    month: point.month,
    partial: point.partial,
    values: { negatives: point.negatives, positives: point.positives },
    note: point.total === 0 ? "Sin controles en el mes" : `${point.total} ${point.total === 1 ? "control" : "controles"} en total`,
  }))

  return (
    <ChartSection
      title="Controles por mes"
      summary={summarizeAlcotestTrend(points)}
      data={{ caption: "Controles de alcotest por mes, con los positivos aparte", ...alcotestTrendDataTable(points) }}
      className={className}
    >
      <MonthlyTrendChart
        data={data}
        bars={[
          { key: "negatives", label: "Negativos", color: CHART_COLORS.brand },
          { key: "positives", label: "Positivos", color: CHART_COLORS.danger },
        ]}
        ariaLabel="Controles de alcotest por mes"
      />
    </ChartSection>
  )
}
