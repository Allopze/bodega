import { MONTH_NAMES, addDaysToPlainDate, todayInChile } from "@/lib/utils"

/**
 * Período de los tableros de Control operacional que no son de Combustible: el Panel de
 * mantención y los Indicadores GPS (Combustible usa el período compartido de su módulo).
 * Desde la crítica del 2026-11-15 los tres tableros comparten un esqueleto, también en el tiempo:
 *
 * - Viaja en la URL como `desde`/`hasta` (fechas civiles «YYYY-MM-DD») y se elige con
 *   `PeriodControl mode="range"` en la cabecera, al lado de la faena.
 * - Sin parámetros: **este mes**, el mismo valor con que abre el Panel de combustible. El control
 *   lo muestra como «Noviembre 2026» y sus flechas van de mes en mes.
 * - Lo que se mide llega hasta hoy: un rango que termina en el futuro (el mes en curso completo)
 *   se corta en hoy para las consultas (`from`/`to`), aunque el control siga mostrando el mes
 *   (`requested`). Así ningún balde futuro se lee como un cero.
 * - El período anterior (para los `Delta`) es, para un mes o lo que va de él, **los mismos días
 *   del mes anterior** (1–15 nov contra 1–15 oct, como Combustible); para cualquier otro rango, el
 *   inmediatamente previo de igual largo. Medio mes contra un mes entero daba caídas falsas.
 * - Los gráficos de evolución usan `chart`: el propio período si abarca tres meses o más; si no,
 *   los seis meses que terminan en él, por mes (la regla de `consumptionChartWindow` de
 *   Combustible). Las cifras del período, los rankings y lo de «hoy» siguen al período.
 */

export type IndicatorGranularity = "day" | "month"

export interface DateRange {
  from: string
  to: string
}

/** Ventana de los gráficos de evolución (ver la cabecera). */
export interface ChartWindow extends DateRange {
  granularity: IndicatorGranularity
  /** `true`: la ventana es más larga que el período (los seis meses que terminan en él). */
  isHistory: boolean
}

export interface IndicatorPeriod extends DateRange {
  /** Granularidad del período mismo; las series usan la de `chart`. */
  granularity: IndicatorGranularity
  previous: DateRange
  /** El rango que pidió la URL (o el por defecto), sin cortar en hoy: es lo que muestra el control. */
  requested: DateRange
  chart: ChartWindow
  /** Es el rango que la pantalla usa sin parámetros. */
  isDefault: boolean
  /** La URL traía un rango inválido (fecha imposible o inicio posterior al término) y se usó el por defecto. */
  invalid: boolean
}

export const DAY_GRANULARITY_MAX_DAYS = 62
/**
 * Rango máximo: cinco años. Un `desde=1001-01-01` arma un balde por mes de diez siglos y las
 * series (la cola de OT se reconstruye balde por balde) bloquearían el servidor; Combustible
 * tiene su propio tope (`MAX_RANGE_DAYS`).
 */
export const MAX_RANGE_DAYS = 5 * 366
/** Cómo se nombra el período por defecto en una frase: «Volver a este mes», «se muestra este mes». */
export const DEFAULT_RANGE_LABEL = "este mes"
/** Meses de la ventana de los gráficos cuando el período es más corto que tres meses. */
export const CHART_HISTORY_MONTHS = 6

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, "0")

export function isPlainDate(value: unknown): value is string {
  if (typeof value !== "string" || !PLAIN_DATE.test(value)) return false
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Días del rango, ambos extremos incluidos. */
export function rangeLengthDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000) + 1
}

/** Primer día del mes de `plainDate` corrido `months` meses (negativo: hacia atrás). */
function monthStart(plainDate: string, months = 0): string {
  const [y = 0, m = 1] = plainDate.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1 + months, 1))
  return date.toISOString().slice(0, 10)
}

function lastDayOfMonth(plainDate: string): number {
  const [y = 0, m = 1] = plainDate.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Este mes calendario completo: el mismo rango que el acceso «Este mes» del control. */
export function defaultIndicatorRange(today: string = todayInChile()): DateRange {
  const from = monthStart(today)
  return { from, to: `${from.slice(0, 8)}${pad(lastDayOfMonth(from))}` }
}

export function indicatorGranularity(from: string, to: string): IndicatorGranularity {
  return rangeLengthDays(from, to) <= DAY_GRANULARITY_MAX_DAYS ? "day" : "month"
}

/**
 * El rango con que se compara: un mes (o lo que va de él) contra los mismos días del mes
 * anterior, acotados a su largo (31 oct → 30 sept); cualquier otro rango, contra el
 * inmediatamente anterior de igual largo.
 */
export function previousRange(from: string, to: string): DateRange {
  if (from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7)) {
    const start = monthStart(from, -1)
    const day = Math.min(Number(to.slice(8, 10)), lastDayOfMonth(start))
    return { from: start, to: `${start.slice(0, 8)}${pad(day)}` }
  }
  const days = rangeLengthDays(from, to)
  const prevTo = addDaysToPlainDate(from, -1)
  return { from: addDaysToPlainDate(prevTo, -(days - 1)), to: prevTo }
}

/** Meses calendario que toca el rango (1 nov–15 nov: 1; 15 sept–15 nov: 3). */
function monthsSpanned(from: string, to: string): number {
  const [fy = 0, fm = 1] = from.split("-").map(Number)
  const [ty = 0, tm = 1] = to.split("-").map(Number)
  return (ty - fy) * 12 + (tm - fm) + 1
}

/** La ventana de los gráficos de evolución de un período (ver la cabecera). */
export function chartWindow(range: DateRange): ChartWindow {
  if (monthsSpanned(range.from, range.to) >= 3) {
    return { ...range, granularity: indicatorGranularity(range.from, range.to), isHistory: false }
  }
  return { from: monthStart(range.to, -(CHART_HISTORY_MONTHS - 1)), to: range.to, granularity: "month", isHistory: true }
}

/**
 * Cómo se dice la ventana de un gráfico de evolución: «Últimos 6 meses, hasta noviembre de 2026»
 * cuando es más larga que el período (la misma frase que Combustible), o sus fechas.
 */
export function chartWindowCaption(window: ChartWindow, formatRange: (range: DateRange) => string): string {
  if (!window.isHistory) return formatRange(window)
  const name = MONTH_NAMES[Number(window.to.slice(5, 7)) - 1] ?? ""
  return `Últimos ${CHART_HISTORY_MONTHS} meses, hasta ${name} de ${window.to.slice(0, 4)}`
}

/**
 * Cómo se nombra el período en un texto del servidor (los metadatos del Excel): «Noviembre 2026»
 * para un mes completo, como lo dice el control; si no, sus fechas.
 */
export function indicatorPeriodLabel(range: DateRange, formatRange: (range: DateRange) => string): string {
  const whole = range.from.endsWith("-01") && range.to === `${range.from.slice(0, 8)}${pad(lastDayOfMonth(range.from))}`
  if (!whole) return formatRange(range)
  const name = MONTH_NAMES[Number(range.from.slice(5, 7)) - 1] ?? ""
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${range.from.slice(0, 4)}`
}

export function resolveIndicatorPeriod(
  input: { desde?: string | string[]; hasta?: string | string[] },
  today: string = todayInChile(),
): IndicatorPeriod {
  const fallback = defaultIndicatorRange(today)
  const rawFrom = typeof input.desde === "string" ? input.desde : undefined
  const rawTo = typeof input.hasta === "string" ? input.hasta : undefined
  const asked = rawFrom !== undefined || rawTo !== undefined
  const from = isPlainDate(rawFrom) ? rawFrom : fallback.from
  const to = isPlainDate(rawTo) ? rawTo : fallback.to
  const badInput = asked && ((rawFrom !== undefined && !isPlainDate(rawFrom)) || (rawTo !== undefined && !isPlainDate(rawTo)))
  const tooLong = from <= to && rangeLengthDays(from, to) > MAX_RANGE_DAYS
  // Un rango que empieza después de hoy no tiene nada que medir.
  const future = from > today
  const invalid = from > to || badInput || tooLong || future
  const requested = invalid ? fallback : { from, to }
  // Lo que se mide llega hasta hoy (el mes en curso completo se corta en hoy).
  const range = { from: requested.from, to: requested.to > today ? today : requested.to }
  return {
    ...range,
    granularity: indicatorGranularity(range.from, range.to),
    previous: previousRange(range.from, range.to),
    requested,
    chart: chartWindow(range),
    isDefault: requested.from === fallback.from && requested.to === fallback.to,
    invalid,
  }
}

/** Clave del balde de una fecha civil: la fecha misma (día) o «YYYY-MM» (mes). */
export function bucketKey(plainDate: string, granularity: IndicatorGranularity): string {
  return granularity === "day" ? plainDate.slice(0, 10) : plainDate.slice(0, 7)
}

/** Todos los baldes del rango, en orden, incluidos los vacíos (un día sin datos es un cero, no un hueco). */
export function listBuckets(from: string, to: string, granularity: IndicatorGranularity): string[] {
  const keys: string[] = []
  if (granularity === "day") {
    for (let day = from; day <= to; day = addDaysToPlainDate(day, 1)) keys.push(day)
    return keys
  }
  let [y = 0, m = 1] = from.split("-").map(Number)
  const end = to.slice(0, 7)
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`
    if (key > end) break
    keys.push(key)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return keys
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"] as const

/** Rótulo corto del balde para un eje: «3 nov» o «nov 2026». */
export function bucketLabel(key: string, granularity: IndicatorGranularity): string {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number)
  const month = MONTHS_SHORT[m - 1] ?? ""
  return granularity === "day" ? `${d} ${month}` : `${month} ${y}`
}

/** El último balde está en curso (el período llega a hoy y el día/mes no ha terminado). */
export function isPartialBucket(key: string, granularity: IndicatorGranularity, today: string = todayInChile()): boolean {
  return granularity === "day" ? key === today : key === today.slice(0, 7)
}
