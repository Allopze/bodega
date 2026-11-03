import type { AnomalySeverity } from "@/lib/combustibles/anomaly-labels"
import { ANOMALY_SEVERITY_LABELS } from "@/lib/combustibles/anomaly-labels"
import { todayInChile } from "@/lib/utils"

/**
 * Casos de anomalía por semana y gravedad (CHART-023b): la forma que recibe el
 * gráfico de «Por revisar». Módulo puro —sin base de datos— para que lo usen la
 * consulta (`getFuelInboxCaseWeeks`), la página y la prueba.
 *
 * Las semanas van de lunes a domingo **en hora de Chile**: un caso detectado el
 * domingo a las 23:30 chilenas ya es lunes en UTC, y medido en UTC caería en la
 * semana siguiente. La última semana de la serie es la en curso y siempre es
 * parcial (todavía le faltan días): el gráfico la dibuja distinta y la frase no
 * la compara con las semanas enteras.
 */

export const ANOMALY_WEEKS_DEFAULT = 12

/** De menor a mayor: el orden de las capas apiladas y de las columnas de «Ver datos». */
export const ANOMALY_SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const satisfies readonly AnomalySeverity[]

/** Una fila del agregado: casos de una gravedad en la semana que parte el lunes `weekStart` ("YYYY-MM-DD", hora de Chile). */
export interface AnomalyWeekRow {
  weekStart: string
  severity: string
  count: number
}

export type AnomalyWeek = Record<AnomalySeverity, number> & {
  /** Lunes de la semana, "YYYY-MM-DD". */
  weekStart: string
  /** Rótulo corto del eje: «26 oct». */
  label: string
  total: number
  /** La semana en curso: todavía no termina. */
  partial: boolean
}

const DAY_MS = 86_400_000
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const

const plainToMs = (plain: string): number => Date.parse(`${plain}T00:00:00Z`)
const msToPlain = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Lunes ("YYYY-MM-DD") de la semana del día chileno de `date`; una fecha sin hora se toma tal cual. */
export function chileWeekStart(date: Date | string | number = new Date()): string {
  const plain = typeof date === "string" && PLAIN_DATE.test(date) ? date : todayInChile(date)
  const ms = plainToMs(plain)
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7
  return msToPlain(ms - sinceMonday * DAY_MS)
}

/** Los lunes de las últimas `weeks` semanas, de la más antigua a la en curso (la última). */
export function anomalyWeekStarts(now: Date | string | number = new Date(), weeks: number = ANOMALY_WEEKS_DEFAULT): string[] {
  const count = Math.max(1, Math.floor(weeks))
  const current = plainToMs(chileWeekStart(now))
  return Array.from({ length: count }, (_, index) => msToPlain(current - (count - 1 - index) * 7 * DAY_MS))
}

const dayAndMonth = (plain: string): { day: number; month: string } => ({
  day: Number(plain.slice(8, 10)),
  month: MONTHS[Number(plain.slice(5, 7)) - 1] ?? "",
})

/** «26 oct»: el lunes de la semana, para el eje. */
function shortLabel(weekStart: string): string {
  const { day, month } = dayAndMonth(weekStart)
  return `${day} ${month}`
}

/** «26 oct al 1 nov», o «2 al 8 nov» cuando la semana no cruza de mes. */
export function anomalyWeekRangeLabel(weekStart: string): string {
  const monday = dayAndMonth(weekStart)
  const sunday = dayAndMonth(msToPlain(plainToMs(weekStart) + 6 * DAY_MS))
  return monday.month === sunday.month ? `${monday.day} al ${sunday.day} ${sunday.month}` : `${monday.day} ${monday.month} al ${sunday.day} ${sunday.month}`
}

const isSeverity = (value: string): value is AnomalySeverity => (ANOMALY_SEVERITY_ORDER as readonly string[]).includes(value)

/**
 * Arma la serie: una entrada por semana de la ventana (con ceros donde no hubo
 * casos), con cada gravedad por separado. Lo que cae fuera de la ventana o trae
 * una gravedad que el vocabulario no conoce no se cuenta.
 */
export function shapeAnomalyWeeks(rows: readonly AnomalyWeekRow[], options: { now?: Date | string | number; weeks?: number } = {}): AnomalyWeek[] {
  const starts = anomalyWeekStarts(options.now, options.weeks)
  const byStart = new Map<string, AnomalyWeek>(starts.map((weekStart, index) => [
    weekStart,
    { weekStart, label: shortLabel(weekStart), low: 0, medium: 0, high: 0, critical: 0, total: 0, partial: index === starts.length - 1 },
  ]))
  for (const row of rows) {
    const week = byStart.get(row.weekStart)
    if (!week || !isSeverity(row.severity)) continue
    week[row.severity] += row.count
    week.total += row.count
  }
  return starts.map((weekStart) => byStart.get(weekStart)!)
}

/** Las gravedades que aparecen en la ventana, de menor a mayor: no se dibujan ni se listan capas siempre vacías. */
export function visibleSeverities(weeks: readonly AnomalyWeek[]): AnomalySeverity[] {
  return ANOMALY_SEVERITY_ORDER.filter((severity) => weeks.some((week) => week[severity] > 0))
}

/**
 * La respuesta del gráfico, en una frase: cuántos casos, qué semana completa fue la
 * más cargada y cuánto lleva la semana en curso. `null` sin ningún caso (el gráfico
 * explica el vacío en vez de dibujar ejes en cero).
 */
export function summarizeAnomalyWeeks(weeks: readonly AnomalyWeek[]): string | null {
  const total = weeks.reduce((sum, week) => sum + week.total, 0)
  if (total === 0) return null
  const current = weeks.at(-1)
  const completed = weeks.filter((week) => !week.partial)
  // Con empate gana la más reciente: lo que se repite hoy importa más que lo de hace dos meses.
  const peak = completed.reduce<AnomalyWeek | null>((best, week) => (week.total > 0 && (!best || week.total >= best.total) ? week : best), null)
  const parts = [`${total === 1 ? "1 caso detectado" : `${total} casos detectados`} en las últimas ${weeks.length} semanas.`]
  if (peak) parts.push(`La semana con más fue la del ${anomalyWeekRangeLabel(peak.weekStart)} (${peak.total}).`)
  if (current?.partial) parts.push(`Esta semana, que sigue en curso, lleva ${current.total}.`)
  return parts.join(" ")
}

/** «Ver datos»: la misma serie en una tabla, con sólo las gravedades presentes y la semana en curso rotulada. */
export function anomalyWeekTable(weeks: readonly AnomalyWeek[]): { headers: string[]; rows: Array<Array<string | number>> } {
  const severities = visibleSeverities(weeks)
  return {
    headers: ["Semana", ...severities.map((severity) => ANOMALY_SEVERITY_LABELS[severity]), "Total"],
    rows: weeks.map((week) => [
      `${anomalyWeekRangeLabel(week.weekStart)}${week.partial ? " (en curso)" : ""}`,
      ...severities.map((severity) => week[severity]),
      week.total,
    ]),
  }
}
