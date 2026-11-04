import { ChartSection } from "@/components/charts/chart-section"
import type { ChartDataExcel } from "@/components/charts/chart-data-table"
import { MonthlyTrendChart, type MonthlyTrendBar, type MonthlyTrendPoint } from "@/components/charts/monthly-trend-chart"
import { RISK_BAND_FILL } from "@/components/charts/risk-bands"
import { CHART_COLORS } from "@/lib/chart-palette"
import {
  FINDING_SEVERITIES,
  inspectionTrendDataTable,
  summarizeInspectionTrend,
  summarizeOpenFindings,
  type FindingSeverity,
  type InspectionTrendPoint,
} from "@/lib/prevention/inspection-trend"
import { countOf } from "@/lib/utils"

/**
 * La gravedad de un hallazgo en tokens semánticos, de gris a rojo (severidad
 * creciente, DESIGN.md § Gráficos). Es el mismo vocabulario que las insignias de
 * gravedad de la inspección (baja en gris, media en ámbar, alta y crítica en
 * rojo) con la alta y la crítica separadas, que en una pila se tienen que poder
 * distinguir: la alta toma el naranja cargado al rojo de las bandas de riesgo
 * (`RISK_BAND_FILL.important`) y la crítica, el rojo del sistema. El color no es
 * la única señal: la leyenda y el tooltip nombran cada gravedad con su cifra.
 */
const SEVERITY_BARS: Record<FindingSeverity, MonthlyTrendBar> = {
  critical: { key: "critical", label: "Gravedad crítica", color: RISK_BAND_FILL.intolerable },
  high: { key: "high", label: "Gravedad alta", color: RISK_BAND_FILL.important },
  medium: { key: "medium", label: "Gravedad media", color: RISK_BAND_FILL.moderate },
  low: { key: "low", label: "Gravedad baja", color: CHART_COLORS.neutral },
}

/**
 * Cumplimiento de inspecciones mes a mes (CHART-010), sobre la bandeja.
 *
 * Responde «¿el cumplimiento mejora?» con una frase y lo dibuja: columnas con las
 * inspecciones realizadas (la referencia, en gris) y la línea del cumplimiento
 * ponderado por ítems (lo propio, en el color de marca) en un eje de porcentaje
 * aparte (A5b). Sigue el mismo universo que los tiles de arriba —alcance, tipo,
 * faena, responsable, rango—, así que filtrar por faena filtra también la serie.
 *
 * Debajo, los hallazgos que siguen abiertos apilados por gravedad, mes a mes
 * (P-4). Es un gráfico aparte y no una serie más del de arriba porque mide otra
 * cosa en otra escala (hallazgos, no inspecciones): compartirían el eje de
 * conteos y la serie chica se aplastaría (A5b). Cada mes dice en su tooltip a
 * cuántas inspecciones corresponde, para que una pila alta no se lea sin saber
 * si salió de 2 inspecciones o de 20.
 *
 * Plegable (cerrado por defecto): la frase del título es la respuesta y el gráfico, el detalle.
 *
 * Sin ninguna inspección ejecutada no se dibuja: la bandeja ya dice que está
 * vacía y un gráfico de ejes en cero no agregaría nada.
 */
export function InspectionTrendSection({ points, className, excel }: {
  points: InspectionTrendPoint[]
  className?: string
  /** Sólo si la página verificó `prevention:inspections:export`: «Ver datos» exporta a Excel. */
  excel?: ChartDataExcel
}) {
  if (points.length === 0) return null

  const compliance: MonthlyTrendPoint[] = points.map((point) => ({
    month: point.month,
    partial: point.partial,
    values: { runs: point.runs },
    rate: point.compliancePercent,
    note: point.compliancePercent !== null
      ? `${countOf(point.scoredRuns, "inspección", "inspecciones")} con ítems · ${countOf(point.items, "ítem evaluado", "ítems evaluados")}`
      : point.runs > 0
        ? "Sin ítems evaluados: no hay cumplimiento que calcular"
        : "Sin inspecciones realizadas en el mes",
  }))
  const openFindings: MonthlyTrendPoint[] = points.map((point) => ({
    month: point.month,
    partial: point.partial,
    values: { ...point.open },
    note: `De ${countOf(point.runs, "inspección", "inspecciones")} del mes`,
  }))
  const findingsSummary = summarizeOpenFindings(points)

  return (
    <ChartSection
      title="Cumplimiento y hallazgos por mes"
      summary={summarizeInspectionTrend(points)}
      data={{ caption: "Inspecciones, cumplimiento ponderado y hallazgos abiertos por mes", ...inspectionTrendDataTable(points), ...(excel ? { excel } : {}) }}
      // La bandeja es lo que se viene a trabajar: la frase responde sola y el gráfico se abre a demanda,
      // para que la tabla no quede bajo el pliegue.
      collapsible
      className={className}
    >
      <MonthlyTrendChart
        data={compliance}
        bars={[{ key: "runs", label: "Inspecciones realizadas", color: CHART_COLORS.neutral }]}
        line={{ label: "Cumplimiento ponderado", color: CHART_COLORS.brand }}
        ariaLabel="Inspecciones realizadas y cumplimiento ponderado por mes"
      />
      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Hallazgos que siguen abiertos</h3>
        {findingsSummary ? (
          <>
            <p className="mt-1 mb-3 text-sm text-[var(--color-text-muted)] text-pretty">
              {findingsSummary} Cada columna agrupa los hallazgos por el mes de la inspección que los registró.
            </p>
            {/* De abajo hacia arriba: lo grave sobre la línea de base, donde se compara mes a mes. */}
            <MonthlyTrendChart
              data={openFindings}
              bars={FINDING_SEVERITIES.map((severity) => SEVERITY_BARS[severity])}
              ariaLabel="Hallazgos abiertos por gravedad y por mes"
            />
          </>
        ) : (
          // Sin hallazgos no hay pila que dibujar (un gráfico de ceros no responde nada) y es una buena noticia.
          <p className="mt-1 text-sm text-[var(--color-text-muted)] text-pretty">
            Ningún hallazgo de las inspecciones de este período sigue abierto.
          </p>
        )}
      </div>
    </ChartSection>
  )
}
