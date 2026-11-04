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

/**
 * Las gravedades de un hallazgo (`prevention_inspection_findings.criticality`),
 * de la más grave a la menos: el orden en que se leen, se apilan de abajo hacia
 * arriba (lo grave sobre la línea de base, donde se compara mes a mes) y se
 * tabulan.
 */
export const FINDING_SEVERITIES = ["critical", "high", "medium", "low"] as const
export type FindingSeverity = typeof FINDING_SEVERITIES[number]

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
  /**
   * Hallazgos que siguen abiertos de las inspecciones del mes, por gravedad. Se
   * fechan por el mes de la inspección que los registró, no por el de su cierre.
   */
  openCritical: number
  openHigh: number
  openMedium: number
  openLow: number
}

export interface InspectionTrendPoint {
  month: string
  runs: number
  scoredRuns: number
  items: number
  weightedPoints: number
  /** `null` si ninguna inspección del mes tiene ítems evaluados: es «sin dato», no 0 %. */
  compliancePercent: number | null
  /** Hallazgos abiertos por gravedad; `openFindings` es su suma (no hay otra gravedad: la tabla lo exige con un CHECK). */
  open: Record<FindingSeverity, number>
  openFindings: number
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
    empty: (month) => ({ month, runs: 0, scoredRuns: 0, scoredItems: 0, weightedPoints: 0, openCritical: 0, openHigh: 0, openMedium: 0, openLow: 0 }),
  })
  return filled.map((row) => {
    const open: Record<FindingSeverity, number> = { critical: row.openCritical, high: row.openHigh, medium: row.openMedium, low: row.openLow }
    return {
      month: row.month,
      runs: row.runs,
      scoredRuns: row.scoredRuns,
      items: row.scoredItems,
      weightedPoints: row.weightedPoints,
      compliancePercent: row.scoredItems > 0 ? oneDecimal(row.weightedPoints / row.scoredItems) : null,
      open,
      openFindings: open.critical + open.high + open.medium + open.low,
      partial: row.partial,
    }
  })
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

/**
 * La frase que acompaña al gráfico de hallazgos abiertos, o `""` si no hay
 * ninguno (entonces no se dibuja: un gráfico de ceros no responde nada).
 *
 * Cuenta HALLAZGOS, no inspecciones: no es la cifra del tile «Con hallazgos
 * abiertos» (que cuenta inspecciones y no se acota a los últimos 12 meses), y
 * la frase lo dice —«de las inspecciones…»— para que no parezcan contradecirse.
 */
export function summarizeOpenFindings(points: readonly InspectionTrendPoint[]): string {
  const withFindings = points.filter((point) => point.openFindings > 0)
  if (withFindings.length === 0) return ""
  const total = withFindings.reduce((sum, point) => sum + point.openFindings, 0)
  const severe = withFindings.reduce((sum, point) => sum + point.open.critical + point.open.high, 0)
  const range = monthRangeText(points[0]!.month, points[points.length - 1]!.month)
  const lead = `${countOf(total, "hallazgo sigue abierto", "hallazgos siguen abiertos")} de las inspecciones ${range}`
  if (severe === 0) return `${lead}; ninguno es de gravedad alta ni crítica.`
  return `${lead}; ${severe} ${severe === 1 ? "es de gravedad alta o crítica" : "son de gravedad alta o crítica"}.`
}

/** «Ver datos»: lo que el gráfico dibuja y lo que sólo insinúa, en cifras. */
export function inspectionTrendDataTable(points: readonly InspectionTrendPoint[]): {
  headers: string[]
  rows: Array<Array<string | number>>
} {
  return {
    headers: [
      "Mes", "Inspecciones", "Ítems evaluados", "Cumplimiento ponderado",
      "Hallazgos abiertos", "De gravedad crítica", "De gravedad alta", "De gravedad media", "De gravedad baja",
    ],
    rows: points.map((point) => [
      point.partial ? `${monthPeriodLabel(point.month)} (en curso)` : monthPeriodLabel(point.month),
      point.runs,
      point.items,
      point.compliancePercent === null ? "—" : formatPercent(point.compliancePercent, 1),
      point.openFindings,
      point.open.critical,
      point.open.high,
      point.open.medium,
      point.open.low,
    ]),
  }
}
