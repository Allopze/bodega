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
 * Un cambio en una regla de detección (CHART-023, P-6): la regla se creó o se modificó.
 *
 * **Por qué está en la serie.** Una regla nueva, o una con el umbral movido, cambia cuántos casos
 * se detectan sin que la operación haya cambiado: el salto de la columna no es un problema real
 * sino el instrumento. Marcar la semana evita que se lea como uno.
 *
 * **De dónde sale la fecha.** `fuel_anomaly_rules` no tiene versionado —sólo `created_at` y
 * `updated_at`, y este último guarda únicamente el último cambio de cada regla—, así que el dato se
 * arma con tres fuentes, de la más completa a la de último recurso:
 *   1. `created_at` de la regla (cubre también las que crea el cron al sincronizar el catálogo, que
 *      no pasan por la auditoría);
 *   2. la bitácora de auditoría (`audit_log`, entidad `fuel_anomaly_rule`): cada edición y cada
 *      activación o desactivación hecha en «Cómo se detecta cada cosa», una por una;
 *   3. `updated_at` de la regla, sólo cuando ninguna entrada de la bitácora lo explica (guardar el
 *      umbral de rendimiento desde Control de combustible toca la regla sin auditarla como regla).
 */
export type AnomalyRuleChangeKind = "created" | "changed"

/** Una fila cruda del origen, ya con el día y la semana medidos en hora de Chile. */
export interface AnomalyRuleChangeRow {
  ruleCode: string
  /** `null` si la regla ya no tiene ficha: se usa su código. */
  ruleName: string | null
  kind: AnomalyRuleChangeKind
  /** De dónde viene: la bitácora (`audit`) o las columnas de la propia regla (`rule`). */
  source: "audit" | "rule"
  /** Día civil de Chile, «YYYY-MM-DD». */
  day: string
  /** Lunes de la semana de ese día, «YYYY-MM-DD». */
  weekStart: string
  /** Instante en segundos desde 1970: sirve para saber si dos filas son el mismo cambio. */
  epoch: number
}

export interface AnomalyRuleChange {
  ruleCode: string
  ruleName: string | null
  kind: AnomalyRuleChangeKind
  day: string
  weekStart: string
}

/** Dos filas de una misma regla a menos de esto son el mismo cambio contado por dos fuentes. */
const SAME_CHANGE_SECONDS = 60

const ruleNameOf = (change: Pick<AnomalyRuleChange, "ruleCode" | "ruleName">): string => change.ruleName ?? change.ruleCode

/**
 * Deja los cambios que caen en la ventana de la serie, sin duplicar el que dos fuentes cuentan
 * (la edición queda en la bitácora **y** en `updated_at`: se cuenta una vez), de más antiguo a más
 * reciente.
 */
export function shapeAnomalyRuleChanges(
  rows: readonly AnomalyRuleChangeRow[],
  options: { now?: Date | string | number; weeks?: number } = {},
): AnomalyRuleChange[] {
  const starts = new Set(anomalyWeekStarts(options.now, options.weeks))
  const audited = rows.filter((row) => row.source === "audit" && row.kind === "changed")
  return rows
    .filter((row) => starts.has(row.weekStart))
    .filter((row) => row.source === "audit" || row.kind === "created"
      || !audited.some((other) => other.ruleCode === row.ruleCode && Math.abs(other.epoch - row.epoch) <= SAME_CHANGE_SECONDS))
    .sort((a, b) => a.epoch - b.epoch || a.ruleCode.localeCompare(b.ruleCode))
    .map(({ ruleCode, ruleName, kind, day, weekStart }) => ({ ruleCode, ruleName, kind, day, weekStart }))
}

/** Los cambios de cada semana, por el lunes que la identifica. */
export function ruleChangesByWeek(changes: readonly AnomalyRuleChange[]): Map<string, AnomalyRuleChange[]> {
  const byWeek = new Map<string, AnomalyRuleChange[]>()
  for (const change of changes) byWeek.set(change.weekStart, [...(byWeek.get(change.weekStart) ?? []), change])
  return byWeek
}

/**
 * Los cambios de una semana en una línea: «Sello repetido» creada el 28 oct. Con más de tres no se
 * enumeran (una instalación nueva crea de golpe todo el catálogo): «23 reglas creadas (28 oct)».
 */
export function ruleChangesText(changes: readonly AnomalyRuleChange[]): string {
  if (changes.length === 0) return ""
  const verb = (kind: AnomalyRuleChangeKind) => (kind === "created" ? "creada" : "modificada")
  if (changes.length <= 3) {
    return changes.map((change) => `«${ruleNameOf(change)}» ${verb(change.kind)} el ${dayAndMonth(change.day).day} ${dayAndMonth(change.day).month}`).join("; ")
  }
  const created = changes.filter((change) => change.kind === "created").length
  const changed = changes.length - created
  const counts = [
    created > 0 ? `${created} ${created === 1 ? "regla creada" : "reglas creadas"}` : null,
    changed > 0 ? `${changed} ${changed === 1 ? "regla modificada" : "reglas modificadas"}` : null,
  ].filter((part): part is string => part !== null).join(" y ")
  const first = dayAndMonth(changes[0]!.day)
  const last = dayAndMonth(changes.at(-1)!.day)
  const span = changes[0]!.day === changes.at(-1)!.day ? `${first.day} ${first.month}` : `${first.day} ${first.month} al ${last.day} ${last.month}`
  return `${counts} (${span})`
}

/**
 * La respuesta del gráfico, en una frase: cuántos casos, qué semana completa fue la
 * más cargada y cuánto lleva la semana en curso. `null` sin ningún caso (el gráfico
 * explica el vacío en vez de dibujar ejes en cero).
 */
export function summarizeAnomalyWeeks(weeks: readonly AnomalyWeek[], ruleChanges: readonly AnomalyRuleChange[] = []): string | null {
  const total = weeks.reduce((sum, week) => sum + week.total, 0)
  if (total === 0) return null
  const current = weeks.at(-1)
  const completed = weeks.filter((week) => !week.partial)
  // Con empate gana la más reciente: lo que se repite hoy importa más que lo de hace dos meses.
  const peak = completed.reduce<AnomalyWeek | null>((best, week) => (week.total > 0 && (!best || week.total >= best.total) ? week : best), null)
  const parts = [`${total === 1 ? "1 caso detectado" : `${total} casos detectados`} en las últimas ${weeks.length} semanas.`]
  if (peak) {
    parts.push(`La semana con más fue la del ${anomalyWeekRangeLabel(peak.weekStart)} (${peak.total}).`)
    // El pico puede ser el instrumento y no la operación: si esa semana cambió una regla, se dice.
    if (ruleChanges.some((change) => change.weekStart === peak.weekStart)) parts.push("En esa semana también cambió una regla de detección: parte de la cifra puede deberse a eso.")
  }
  if (current?.partial) parts.push(`Esta semana, que sigue en curso, lleva ${current.total}.`)
  return parts.join(" ")
}

/**
 * «Ver datos»: la misma serie en una tabla, con sólo las gravedades presentes y la semana en curso
 * rotulada. Con cambios de reglas suma una columna «Cambios de reglas»: es la alternativa en texto de
 * las líneas del gráfico (un lector de pantalla no ve una línea punteada).
 */
export function anomalyWeekTable(weeks: readonly AnomalyWeek[], ruleChanges: readonly AnomalyRuleChange[] = []): { headers: string[]; rows: Array<Array<string | number>> } {
  const severities = visibleSeverities(weeks)
  const byWeek = ruleChangesByWeek(ruleChanges)
  const withChanges = byWeek.size > 0
  return {
    headers: ["Semana", ...severities.map((severity) => ANOMALY_SEVERITY_LABELS[severity]), "Total", ...(withChanges ? ["Cambios de reglas"] : [])],
    rows: weeks.map((week) => [
      `${anomalyWeekRangeLabel(week.weekStart)}${week.partial ? " (en curso)" : ""}`,
      ...severities.map((severity) => week[severity]),
      week.total,
      ...(withChanges ? [ruleChangesText(byWeek.get(week.weekStart) ?? []) || "—"] : []),
    ]),
  }
}
