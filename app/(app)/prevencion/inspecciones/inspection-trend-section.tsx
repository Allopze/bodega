import { ChartSection } from "@/components/charts/chart-section"
import { MonthlyTrendChart, type MonthlyTrendPoint } from "@/components/charts/monthly-trend-chart"
import { CHART_COLORS } from "@/lib/chart-palette"
import {
  inspectionTrendDataTable,
  summarizeInspectionTrend,
  type InspectionTrendPoint,
} from "@/lib/prevention/inspection-trend"
import { countOf } from "@/lib/utils"

/**
 * Cumplimiento de inspecciones mes a mes (CHART-010), sobre la bandeja.
 *
 * Responde «¿el cumplimiento mejora?» con una frase y lo dibuja: columnas con las
 * inspecciones realizadas (la referencia, en gris) y la línea del cumplimiento
 * ponderado por ítems (lo propio, en el color de marca) en un eje de porcentaje
 * aparte (A5b). Sigue el mismo universo que los tiles de arriba —alcance, tipo,
 * faena, responsable, rango—, así que filtrar por faena filtra también la serie.
 *
 * Plegable (cerrado por defecto): la frase del título es la respuesta y el gráfico, el detalle.
 *
 * Sin ninguna inspección ejecutada no se dibuja: la bandeja ya dice que está
 * vacía y un gráfico de ejes en cero no agregaría nada.
 */
export function InspectionTrendSection({ points, className }: { points: InspectionTrendPoint[]; className?: string }) {
  if (points.length === 0) return null

  const data: MonthlyTrendPoint[] = points.map((point) => ({
    month: point.month,
    partial: point.partial,
    values: { runs: point.runs },
    rate: point.compliancePercent,
    note: [
      point.compliancePercent !== null
        ? `${countOf(point.scoredRuns, "inspección", "inspecciones")} con ítems · ${countOf(point.items, "ítem evaluado", "ítems evaluados")}`
        : point.runs > 0
          ? "Sin ítems evaluados: no hay cumplimiento que calcular"
          : "Sin inspecciones realizadas en el mes",
      // Los hallazgos no se dibujan (la línea es el cumplimiento), pero tampoco se esconden.
      point.openFindings > 0
        ? `${countOf(point.openFindings, "hallazgo abierto", "hallazgos abiertos")}${point.criticalOpenFindings > 0 ? ` (${point.criticalOpenFindings} alto o crítico)` : ""}`
        : null,
    ].filter(Boolean).join(" · "),
  }))

  return (
    <ChartSection
      title="Cumplimiento por mes"
      summary={summarizeInspectionTrend(points)}
      data={{ caption: "Inspecciones y cumplimiento ponderado por mes", ...inspectionTrendDataTable(points) }}
      // La bandeja es lo que se viene a trabajar: la frase responde sola y el gráfico se abre a demanda,
      // para que la tabla no quede bajo el pliegue.
      collapsible
      className={className}
    >
      <MonthlyTrendChart
        data={data}
        bars={[{ key: "runs", label: "Inspecciones realizadas", color: CHART_COLORS.neutral }]}
        line={{ label: "Cumplimiento ponderado", color: CHART_COLORS.brand }}
        ariaLabel="Inspecciones realizadas y cumplimiento ponderado por mes"
      />
    </ChartSection>
  )
}
