import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/**
 * Período de las pantallas de Indicadores de Control operacional (GPS y
 * Mantención; Combustible usa el período compartido de su módulo).
 *
 * - Viaja en la URL como `desde`/`hasta` (fechas civiles «YYYY-MM-DD»), igual que
 *   el Panel operacional, y se elige con `PeriodControl mode="range"`.
 * - Sin parámetros: los últimos seis meses calendario, el en curso incluido.
 * - La granularidad de las series se deriva del largo del rango: por día hasta
 *   `DAY_GRANULARITY_MAX_DAYS`, por mes sobre eso. Sesenta barras diarias aún se
 *   leen; ciento ochenta no.
 * - El período anterior (para los `Delta`) es el inmediatamente previo de igual
 *   largo.
 */

export type IndicatorGranularity = "day" | "month"

export interface DateRange {
  from: string
  to: string
}

export interface IndicatorPeriod extends DateRange {
  granularity: IndicatorGranularity
  previous: DateRange
  /** Es el rango que la pantalla usa sin parámetros. */
  isDefault: boolean
  /** La URL traía un rango inválido (fecha imposible o inicio posterior al término) y se usó el por defecto. */
  invalid: boolean
}

export const DAY_GRANULARITY_MAX_DAYS = 62
export const DEFAULT_RANGE_LABEL = "los últimos 6 meses"

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlainDate(value: unknown): value is string {
  if (typeof value !== "string" || !PLAIN_DATE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Días del rango, ambos extremos incluidos. */
export function rangeLengthDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000) + 1
}

/** Primer día del mes `months` meses antes del de `today`, hasta `today`. */
export function defaultIndicatorRange(today: string = todayInChile(), months = 6): DateRange {
  const [y, m] = today.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1 - (months - 1), 1))
  return { from: start.toISOString().slice(0, 10), to: today }
}

export function indicatorGranularity(from: string, to: string): IndicatorGranularity {
  return rangeLengthDays(from, to) <= DAY_GRANULARITY_MAX_DAYS ? "day" : "month"
}

/** El rango inmediatamente anterior de igual largo. */
export function previousRange(from: string, to: string): DateRange {
  const days = rangeLengthDays(from, to)
  const prevTo = addDaysToPlainDate(from, -1)
  return { from: addDaysToPlainDate(prevTo, -(days - 1)), to: prevTo }
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
  const range = from > to || badInput ? fallback : { from, to }
  return {
    ...range,
    granularity: indicatorGranularity(range.from, range.to),
    previous: previousRange(range.from, range.to),
    isDefault: range.from === fallback.from && range.to === fallback.to,
    invalid: from > to || badInput,
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
  let [y, m] = from.split("-").map(Number)
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
  const [y, m, d] = key.split("-").map(Number)
  const month = MONTHS_SHORT[m - 1] ?? ""
  return granularity === "day" ? `${d} ${month}` : `${month} ${y}`
}

/** El último balde está en curso (el período llega a hoy y el día/mes no ha terminado). */
export function isPartialBucket(key: string, granularity: IndicatorGranularity, today: string = todayInChile()): boolean {
  return granularity === "day" ? key === today : key === today.slice(0, 7)
}
