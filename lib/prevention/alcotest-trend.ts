/**
 * lib/prevention/alcotest-trend.ts
 *
 * La serie mensual de controles de alcotest (CHART-010, mitad alcotest, de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`): qué dibuja el gráfico y qué frase lo
 * resume.
 *
 * **Sólo conteos agregados.** Un resultado positivo es un dato sensible de una
 * persona: la consulta entrega cuántos controles hubo y cuántos dieron positivo
 * por mes, nunca a quién, y esta serie no tiene dónde guardarlo. Tampoco calcula
 * una tasa: con un puñado de controles por mes un «porcentaje de positivos» sería
 * una cifra pelada que se lee como un diagnóstico; los conteos dicen lo mismo con
 * su base a la vista.
 *
 * Lógica pura, sin base de datos ni React.
 */

import { countOf } from "@/lib/utils"
import { fillMonthSeries, monthPeriodLabel, monthRangeText } from "./monthly-series"

/** Una fila de la consulta: los controles de un mes civil chileno. */
export interface AlcotestTrendRow {
  month: string
  total: number
  positives: number
}

export interface AlcotestTrendPoint {
  month: string
  total: number
  positives: number
  negatives: number
  /** El mes en curso, que todavía no termina. */
  partial: boolean
}

export function shapeAlcotestTrend(rows: readonly AlcotestTrendRow[], today: string): AlcotestTrendPoint[] {
  return fillMonthSeries<AlcotestTrendRow>(rows, {
    today,
    empty: (month) => ({ month, total: 0, positives: 0 }),
  }).map((row) => ({
    month: row.month,
    total: row.total,
    positives: row.positives,
    // Un positivo nunca supera al total, pero una fila inconsistente no debe
    // dibujar una columna negativa.
    negatives: Math.max(0, row.total - row.positives),
    partial: row.partial,
  }))
}

/** La frase que responde «¿cuántos controles hubo y cuántos dieron positivo?». */
export function summarizeAlcotestTrend(points: readonly AlcotestTrendPoint[]): string {
  const withControls = points.filter((point) => point.total > 0)
  if (withControls.length === 0) return ""
  const total = withControls.reduce((sum, point) => sum + point.total, 0)
  const positives = withControls.reduce((sum, point) => sum + point.positives, 0)
  const range = monthRangeText(withControls[0]!.month, withControls[withControls.length - 1]!.month)

  if (total === 1) return `1 control ${range}: ${positives > 0 ? "resultó positivo" : "resultó negativo"}.`
  if (positives === 0) return `${total} controles ${range}, ninguno positivo.`
  return `${positives} de ${countOf(total, "control", "controles")} ${range} ${positives === 1 ? "resultó positivo" : "resultaron positivos"}.`
}

/** «Ver datos». */
export function alcotestTrendDataTable(points: readonly AlcotestTrendPoint[]): {
  headers: string[]
  rows: Array<Array<string | number>>
} {
  return {
    headers: ["Mes", "Controles", "Negativos", "Positivos"],
    rows: points.map((point) => [
      point.partial ? `${monthPeriodLabel(point.month)} (en curso)` : monthPeriodLabel(point.month),
      point.total,
      point.negatives,
      point.positives,
    ]),
  }
}
