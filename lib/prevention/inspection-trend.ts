/**
 * lib/prevention/inspection-trend.ts
 *
 * La serie mensual de cumplimiento de inspecciones (CHART-010 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`): qué dibuja el gráfico y qué frase lo
 * resume.
 *
 * **El cumplimiento de un mes pondera por ítems, no promedia porcentajes.** Un
 * promedio de porcentajes trata igual a una inspección de 8 ítems y a una de
 * 120: una sola pauta corta mal respondida hundiría el mes. Cada inspección
 * aporta su propio porcentaje (el que la bandeja muestra en su fila, ya
 * normalizado con el peso de 0,5 de «Regular») multiplicado por los ítems que
 * evaluó, y el mes es Σ(porcentaje × ítems) / Σ(ítems).
 *
 * Los «ítems evaluados» de una inspección son conformes + parciales + no
 * conformes. Es la mejor base que la fila guarda; difiere del denominador exacto
 * del porcentaje sólo cuando el instrumento tiene ítems que se responden pero no
 * puntúan (la reinstrucción del encabezado), y ahí el peso queda levemente por
 * encima del real. El porcentaje de cada inspección, que es lo que se pondera,
 * es exacto.
 *
 * Lógica pura, sin base de datos ni React: la consulta entrega sumas por mes y
 * aquí se decide qué mes es hueco, cuál es parcial y qué se puede afirmar.
 */

import { countOf, formatPercent, formatQty } from "@/lib/utils"
import { addMonths, fillMonthSeries, monthPeriodLabel, monthPeriodName, monthRangeText } from "./monthly-series"

/** Una fila de la consulta: sumas de un mes de inspecciones ejecutadas. */
export interface InspectionTrendRow {
  month: string
  runs: number
  /** Inspecciones con porcentaje calculable y al menos un ítem evaluado. */
  scoredRuns: number
  /** Σ de ítems evaluados de esas inspecciones. */
  scoredItems: number
  /** Σ(porcentaje de la inspección × sus ítems evaluados). */
  weightedPoints: number
  openFindings: number
  criticalOpenFindings: number
}

export interface InspectionTrendPoint {
  month: string
  runs: number
  scoredRuns: number
  items: number
  weightedPoints: number
  /** `null` si ninguna inspección del mes tiene ítems evaluados: es «sin dato», no 0 %. */
  compliancePercent: number | null
  openFindings: number
  criticalOpenFindings: number
  /** El mes en curso: sus pocos días no son una caída. */
  partial: boolean
}

/** Un decimal alcanza: 78,46 % y 78,5 % no cambian ninguna decisión. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

export function shapeInspectionTrend(rows: readonly InspectionTrendRow[], today: string): InspectionTrendPoint[] {
  const filled = fillMonthSeries<InspectionTrendRow>(rows, {
    today,
    empty: (month) => ({ month, runs: 0, scoredRuns: 0, scoredItems: 0, weightedPoints: 0, openFindings: 0, criticalOpenFindings: 0 }),
  })
  return filled.map((row) => ({
    month: row.month,
    runs: row.runs,
    scoredRuns: row.scoredRuns,
    items: row.scoredItems,
    weightedPoints: row.weightedPoints,
    compliancePercent: row.scoredItems > 0 ? oneDecimal(row.weightedPoints / row.scoredItems) : null,
    openFindings: row.openFindings,
    criticalOpenFindings: row.criticalOpenFindings,
    partial: row.partial,
  }))
}

function pointsText(delta: number): string {
  const abs = Math.abs(delta)
  return `${formatQty(abs, undefined, { maximumFractionDigits: 1 })} ${abs === 1 ? "punto" : "puntos"}`
}

/**
 * La frase que responde la pregunta del gráfico («¿el cumplimiento mejora?»).
 *
 * Compara sólo dos meses COMPLETOS y contiguos: el mes en curso tiene pocos días
 * y un mes sin dato en medio no deja decir «frente al anterior». Si no hay ese
 * par, no afirma ninguna tendencia.
 */
export function summarizeInspectionTrend(points: readonly InspectionTrendPoint[]): string {
  if (points.length === 0) return ""
  const totalRuns = points.reduce((sum, point) => sum + point.runs, 0)
  const scored = points.filter((point) => point.compliancePercent !== null)

  if (scored.length === 0) {
    return `${countOf(totalRuns, "inspección realizada", "inspecciones realizadas")} en el período, ninguna con ítems evaluados: todavía no hay un cumplimiento que calcular.`
  }

  const items = scored.reduce((sum, point) => sum + point.items, 0)
  const weighted = scored.reduce((sum, point) => sum + point.weightedPoints, 0)
  const scoredRuns = scored.reduce((sum, point) => sum + point.scoredRuns, 0)
  const overall = oneDecimal(weighted / items)
  const base = `Cumplimiento ponderado por ítems de ${formatPercent(overall, 1)} ${monthRangeText(scored[0]!.month, scored[scored.length - 1]!.month)} `
    + `(${countOf(scoredRuns, "inspección", "inspecciones")}, ${countOf(items, "ítem evaluado", "ítems evaluados")})`

  const complete = scored.filter((point) => !point.partial)
  const latest = complete[complete.length - 1]
  const previous = latest ? complete.find((point) => point.month === addMonths(latest.month, -1)) : undefined
  if (!latest || !previous) return `${base}.`

  const delta = oneDecimal(latest.compliancePercent! - previous.compliancePercent!)
  const comparison = delta === 0
    ? `igual que en ${monthPeriodName(previous.month)}`
    : `${pointsText(delta)} ${delta > 0 ? "sobre" : "bajo"} ${monthPeriodName(previous.month)}`
  return `${base}. En ${monthPeriodName(latest.month)} fue de ${formatPercent(latest.compliancePercent!, 1)}, ${comparison}.`
}

/** «Ver datos»: lo que el gráfico dibuja y lo que sólo insinúa, en cifras. */
export function inspectionTrendDataTable(points: readonly InspectionTrendPoint[]): {
  headers: string[]
  rows: Array<Array<string | number>>
} {
  return {
    headers: ["Mes", "Inspecciones", "Ítems evaluados", "Cumplimiento ponderado", "Hallazgos abiertos", "De ellos, altos o críticos"],
    rows: points.map((point) => [
      point.partial ? `${monthPeriodLabel(point.month)} (en curso)` : monthPeriodLabel(point.month),
      point.runs,
      point.items,
      point.compliancePercent === null ? "—" : formatPercent(point.compliancePercent, 1),
      point.openFindings,
      point.criticalOpenFindings,
    ]),
  }
}
