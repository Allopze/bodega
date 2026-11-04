/**
 * lib/prevention/monthly-series.ts
 *
 * Utilidades puras de las series mensuales de Prevención (inspecciones,
 * alcotest, PPA; CHART-010 y CHART-011 de `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Los tres gráficos comparten el mismo problema de forma: la consulta entrega
 * sólo los meses que TIENEN filas, y un gráfico que une esos meses como si
 * fueran contiguos dibuja una tendencia falsa. Un mes sin actividad entre dos
 * con actividad es un hueco que se ve, no un mes que desaparece; y el mes en
 * curso es parcial, no una caída. Aquí viven las dos reglas, una sola vez.
 *
 * Los meses viajan como `YYYY-MM` del calendario CHILENO (la consulta los
 * produce con `AT TIME ZONE 'America/Santiago'`), nunca como `Date`.
 */

import { MONTH_LABELS, MONTH_NAMES } from "@/lib/utils"

/** Cuántos meses mira por defecto una serie: un año completo, no la historia. */
export const MONTHLY_SERIES_WINDOW = 12

const MONTH_KEY = /^(\d{4})-(\d{2})$/

function parseMonth(key: string): { year: number; month: number } | null {
  const match = MONTH_KEY.exec(key)
  if (!match) return null
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null
}

/** `YYYY-MM` de un día `YYYY-MM-DD` (el resultado de `todayInChile()`). */
export function monthOfDay(day: string): string {
  return day.slice(0, 7)
}

/** Suma `delta` meses (puede ser negativo) a un `YYYY-MM`. */
export function addMonths(key: string, delta: number): string {
  const parsed = parseMonth(key)
  if (!parsed) return key
  const index = parsed.year * 12 + (parsed.month - 1) + delta
  const year = Math.floor(index / 12)
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** Todos los `YYYY-MM` entre `from` y `to`, ambos incluidos. Vacío si `to < from`. */
export function monthsBetween(from: string, to: string): string[] {
  if (!parseMonth(from) || !parseMonth(to) || to < from) return []
  const months: string[] = []
  for (let cursor = from; cursor <= to; cursor = addMonths(cursor, 1)) months.push(cursor)
  return months
}

/**
 * Primer día (`YYYY-MM-01`) de la ventana de `months` meses que termina en el
 * mes de `today`. Con `months = 12` y hoy 2026-11-03, la ventana parte el
 * 2025-12-01. Es el corte que la consulta aplica en SQL: la serie no trae la
 * historia entera para recortarla después.
 */
export function windowStartDay(today: string, months = MONTHLY_SERIES_WINDOW): string {
  return `${addMonths(monthOfDay(today), -(months - 1))}-01`
}

/** «Oct 2026». */
export function monthPeriodLabel(key: string): string {
  const parsed = parseMonth(key)
  return parsed ? `${MONTH_LABELS[parsed.month - 1]} ${parsed.year}` : key
}

/** «octubre» o, si el año importa, «octubre de 2026». */
export function monthPeriodName(key: string, withYear = false): string {
  const parsed = parseMonth(key)
  if (!parsed) return key
  const name = MONTH_NAMES[parsed.month - 1]!
  return withYear ? `${name} de ${parsed.year}` : name
}

/**
 * «en octubre» o «entre agosto y octubre»; con el año («diciembre de 2025») sólo
 * si la ventana cruza de año. Es la cola de las frases que resumen una serie.
 */
export function monthRangeText(first: string, last: string): string {
  if (first === last) return `en ${monthPeriodName(first)}`
  const crossesYears = first.slice(0, 4) !== last.slice(0, 4)
  return `entre ${monthPeriodName(first, crossesYears)} y ${monthPeriodName(last, crossesYears)}`
}

/**
 * Completa los meses sin filas. La serie va del primer mes con datos (o del
 * inicio de la ventana, si éste es posterior) hasta el mes en curso, y cada mes
 * que la consulta no devolvió se rellena con `empty(month)`. Sin ninguna fila
 * no hay serie: un gráfico de puros meses vacíos no responde nada.
 *
 * Los meses de una fila fuera de la ventana se descartan; la consulta ya los
 * recorta, pero esta función no debe depender de eso para no mentir.
 */
export function fillMonthSeries<T extends { month: string }>(
  rows: readonly T[],
  options: { today: string; months?: number; empty: (month: string) => T },
): Array<T & { partial: boolean }> {
  const currentMonth = monthOfDay(options.today)
  const windowStart = monthOfDay(windowStartDay(options.today, options.months))
  const inWindow = rows.filter((row) => row.month >= windowStart && row.month <= currentMonth)
  if (inWindow.length === 0) return []

  const byMonth = new Map(inWindow.map((row) => [row.month, row]))
  const first = inWindow.reduce((min, row) => (row.month < min ? row.month : min), inWindow[0]!.month)
  return monthsBetween(first, currentMonth).map((month) => ({
    ...(byMonth.get(month) ?? options.empty(month)),
    partial: month === currentMonth,
  }))
}
