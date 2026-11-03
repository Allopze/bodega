/**
 * lib/services/billing/summary-charts.ts
 *
 * Derivaciones **puras** del resumen de `/facturacion` (CHART-036, auditoría de
 * visualizaciones 2026-11-03): la serie mensual por moneda, la variación contra
 * el mes anterior, los rankings por moneda y la antigüedad de la deuda.
 *
 * `getBillingSummary` ya consultaba todo esto —`monthly` se traía y la página no
 * lo dibujaba—; acá sólo se le da forma. Sin base de datos ni React, para que la
 * regla que las atraviesa se pruebe sola:
 *
 * **Nunca se suman monedas distintas.** Cada función separa por moneda antes de
 * operar, y quien dibuja arma un gráfico o una lista por cada una.
 */

import { formatPercent, MONTH_LABELS, MONTH_NAMES } from "@/lib/utils"
import { formatMoney, type MoneyAmount } from "./money"
import type { BillingSummary } from "./queries"

export type BillingMonthlyRow = BillingSummary["monthly"][number]
export type BillingAgingRow = BillingSummary["aging"][number]

export interface FlowRow {
  period: string
  invoiced: number
  collected: number
}

export interface CurrencySeries {
  currency: string
  rows: FlowRow[]
}

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/

/** CLP primero (la moneda de la operación) y el resto por orden alfabético. */
export function compareCurrencies(a: string, b: string): number {
  if (a === b) return 0
  if (a === "CLP") return -1
  if (b === "CLP") return 1
  return a.localeCompare(b)
}

/** Desplaza un período `YYYY-MM` por meses; uno que no calza se devuelve tal cual. */
function shiftPeriod(period: string, months: number): string {
  const match = PERIOD.exec(period)
  if (!match) return period
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** "2026-01" → "2025-12". */
export function previousPeriod(period: string): string {
  return shiftPeriod(period, -1)
}

/** "2026-07" → "Jul 2026". Una clave que no calza se deja tal cual. */
export function billingPeriodLabel(period: string): string {
  const match = PERIOD.exec(period)
  const label = match ? MONTH_LABELS[Number(match[2]) - 1] : undefined
  return match && label ? `${label} ${match[1]}` : period
}

/** "2026-07" → "julio de 2026". */
function periodName(period: string): string {
  const match = PERIOD.exec(period)
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined
  return match && name ? `${name} de ${match[1]}` : period
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/* ── Facturado y cobrado, mes a mes ──────────────────────────────────────── */

/**
 * La serie mensual de cada moneda, de más antiguo a más reciente.
 *
 * - Corta en `upTo`: `getBillingSummary` no tiene tope superior, y una página
 *   que mira un período pasado no debe mostrar meses posteriores.
 * - Un mes sin facturas **es un cero**, no un hueco: sin relleno el eje saltaría
 *   del mes 8 al 10 y el gráfico mentiría sobre el tiempo. Se rellena entre el
 *   primer y el último mes con datos de esa moneda, no más allá.
 * - Una moneda sin ningún monto no aparece.
 */
export function flowSeriesByCurrency(monthly: BillingMonthlyRow[], upTo: string): CurrencySeries[] {
  const byCurrency = new Map<string, Map<string, FlowRow>>()
  for (const row of monthly) {
    if (row.period > upTo) continue
    const months = byCurrency.get(row.currency) ?? new Map<string, FlowRow>()
    const current = months.get(row.period) ?? { period: row.period, invoiced: 0, collected: 0 }
    months.set(row.period, {
      period: row.period,
      invoiced: current.invoiced + row.invoiced,
      collected: current.collected + row.collected,
    })
    byCurrency.set(row.currency, months)
  }

  const series: CurrencySeries[] = []
  for (const currency of [...byCurrency.keys()].sort(compareCurrencies)) {
    const months = byCurrency.get(currency)!
    const periods = [...months.keys()].sort()
    const first = periods[0]
    const last = periods[periods.length - 1]
    if (!first || !last) continue

    const rows: FlowRow[] = []
    for (let period = first; period <= last; period = shiftPeriod(period, 1)) {
      rows.push(months.get(period) ?? { period, invoiced: 0, collected: 0 })
      if (!PERIOD.test(period)) break
    }
    if (rows.some((row) => row.invoiced !== 0 || row.collected !== 0)) series.push({ currency, rows })
  }
  return series
}

/**
 * Variación porcentual de `current` contra el mismo campo del mes anterior, en
 * la misma moneda. `null` cuando no hay con qué comparar —sin mes anterior o con
 * el anterior en cero— porque un porcentaje sobre cero no existe y escribir uno
 * sería inventarlo.
 */
export function previousMonthChange(
  monthly: BillingMonthlyRow[],
  period: string,
  currency: string,
  field: "invoiced" | "collected",
  current: number,
): number | null {
  const before = previousPeriod(period)
  const previous = monthly
    .filter((row) => row.period === before && row.currency === currency)
    .reduce((sum, row) => sum + row[field], 0)
  if (!(previous > 0) || !Number.isFinite(current)) return null
  return ((current - previous) / previous) * 100
}

/** Una variación por cada moneda de un tile (que apila una cifra por moneda). */
export function changesByCurrency(
  monthly: BillingMonthlyRow[],
  period: string,
  field: "invoiced" | "collected",
  amounts: readonly MoneyAmount[],
): Record<string, number | null> {
  return Object.fromEntries(
    amounts.map((money) => [money.currency, previousMonthChange(monthly, period, money.currency, field, money.amount)]),
  )
}

/**
 * La frase que responde el gráfico: cuánto se facturó en la ventana y qué parte
 * está cobrada. `partialPeriod` avisa del mes en curso, que no es una caída.
 */
export function flowInsight(series: CurrencySeries, partialPeriod?: string): string {
  const { rows, currency } = series
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (!first || !last) return ""

  const invoiced = rows.reduce((sum, row) => sum + row.invoiced, 0)
  const collected = rows.reduce((sum, row) => sum + row.collected, 0)

  let window: string
  if (first.period === last.period) {
    window = `En ${periodName(first.period)}`
  } else if (first.period.slice(0, 4) === last.period.slice(0, 4)) {
    window = `Entre ${periodName(first.period).replace(/ de \d{4}$/, "")} y ${periodName(last.period)}`
  } else {
    window = `Entre ${periodName(first.period)} y ${periodName(last.period)}`
  }

  const share = invoiced > 0 ? ` y el ${formatPercent((collected / invoiced) * 100, 0)} está cobrado` : ""
  const partial = partialPeriod && rows.some((row) => row.period === partialPeriod)
    ? ` ${capitalize(periodName(partialPeriod))} está en curso y su cifra es parcial.`
    : ""
  return `${window} se facturaron ${formatMoney(invoiced, currency)}${share}.${partial}`
}

/** «Ver datos» del gráfico de flujo: un renglón por mes. */
export function flowTable(series: CurrencySeries): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Mes", "Facturado", "Cobrado", "Cobrado %"],
    rows: series.rows.map((row) => [
      billingPeriodLabel(row.period),
      formatMoney(row.invoiced, series.currency),
      formatMoney(row.collected, series.currency),
      row.invoiced > 0 ? formatPercent((row.collected / row.invoiced) * 100, 0) : "—",
    ]),
  }
}

/* ── Rankings por moneda ─────────────────────────────────────────────────── */

export interface RankingItem {
  key: string
  label: string
  value: number
  detail?: string
}

export interface RankingGroup {
  currency: string
  items: RankingItem[]
}

/**
 * Una lista por moneda, de mayor a menor. Una barra en un eje común no sabe de
 * monedas: 1.000 USD junto a 900.000 CLP se leería como una barra 900 veces más
 * corta, así que cada moneda tiene su propio ranking.
 *
 * Con `invoiced` (lo facturado de la moneda en el período) cada fila dice su
 * parte. El `RankedList` calcularía el porcentaje sobre las filas que recibe, y
 * eso es engañoso: la consulta ya recorta a las primeras 10 o 15. Si el vínculo
 * supera el total (datos incoherentes) el porcentaje se omite.
 */
export function rankingByCurrency(
  rows: ReadonlyArray<{ label: string; currency: string; amount: number }>,
  invoiced: readonly MoneyAmount[] = [],
): RankingGroup[] {
  const currencies = [...new Set(rows.filter((row) => row.amount > 0).map((row) => row.currency))].sort(compareCurrencies)

  return currencies.map((currency) => {
    const total = invoiced.find((money) => money.currency === currency)?.amount ?? 0
    const items = rows
      .filter((row) => row.currency === currency && row.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map<RankingItem>((row, index) => {
        const share = total > 0 ? (row.amount / total) * 100 : null
        return {
          key: `${currency}-${index}-${row.label}`,
          label: row.label,
          value: row.amount,
          ...(share !== null && share <= 100
            ? { detail: `${share < 1 ? "<1%" : formatPercent(share, 0)} de lo facturado` }
            : {}),
        }
      })
    return { currency, items }
  })
}

/* ── Antigüedad de la deuda ──────────────────────────────────────────────── */

export interface AgingChartBucket {
  key: string
  label: string
  amount: number
  /** `null` cuando hay varias monedas: el conteo del servicio suma todas. */
  count: number | null
}

/**
 * Las monedas de la antigüedad: `charted` son las que tienen saldo en algún
 * tramo (un gráfico por cada una) y `singleCurrency` dice si hay una sola entre
 * todas las facturas abiertas, que es cuando el conteo de facturas del servicio
 * —que suma todas las monedas— sí corresponde al monto que se dibuja.
 */
export function agingCurrencies(aging: readonly BillingAgingRow[]): { charted: string[]; singleCurrency: boolean } {
  const all = new Set(aging.flatMap((bucket) => bucket.byCurrency.map((money) => money.currency)))
  const charted = [...all]
    .filter((currency) => aging.some((bucket) => (bucket.byCurrency.find((money) => money.currency === currency)?.amount ?? 0) > 0))
    .sort(compareCurrencies)
  return { charted, singleCurrency: all.size <= 1 }
}

/**
 * Los tramos de una moneda **en el orden de los días** (el de `AGING_BUCKETS`):
 * es una línea de tiempo, no un ranking, y jamás se reordena por monto.
 */
export function agingBucketsFor(aging: readonly BillingAgingRow[], currency: string, withCounts: boolean): AgingChartBucket[] {
  return aging.map((bucket) => ({
    key: bucket.bucket,
    label: bucket.label,
    amount: bucket.byCurrency.find((money) => money.currency === currency)?.amount ?? 0,
    count: withCounts ? bucket.count : null,
  }))
}

const OVER_30 = new Set(["d31_60", "d61_90", "d90_plus"])

/** La frase de la antigüedad: qué parte del saldo lleva más de 30 días vencida. */
export function agingInsight(buckets: readonly AgingChartBucket[], currency: string): string | null {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.amount), 0)
  if (total <= 0) return null

  const over30 = buckets.filter((bucket) => OVER_30.has(bucket.key)).reduce((sum, bucket) => sum + Math.max(0, bucket.amount), 0)
  if (over30 > 0) {
    return `El ${formatPercent((over30 / total) * 100, 0)} del saldo lleva más de 30 días vencido: ${formatMoney(over30, currency)}.`
  }
  const overdue = buckets.some((bucket) => bucket.key !== "not_due" && bucket.amount > 0)
  return overdue
    ? "Ningún saldo lleva más de 30 días vencido."
    : "Todo el saldo está al día: ninguna factura ha vencido."
}

/**
 * «Ver datos» de la antigüedad: la tabla de siempre —tramo, facturas y saldo por
 * moneda—. Con `currency` el saldo es el de esa moneda; con `withCounts: false`
 * se omite «Facturas», porque el conteo del servicio suma todas las monedas.
 */
export function agingTable(
  aging: readonly BillingAgingRow[],
  options: { currency?: string; withCounts?: boolean } = {},
): { headers: string[]; rows: Array<Array<string | number>> } {
  const withCounts = options.withCounts ?? true
  return {
    headers: withCounts ? ["Tramo", "Facturas", "Saldo"] : ["Tramo", "Saldo"],
    rows: aging.map((bucket) => {
      const amounts = options.currency
        ? bucket.byCurrency.filter((money) => money.currency === options.currency)
        : bucket.byCurrency
      const balance = amounts.length === 0
        ? "—"
        : amounts.map((money) => formatMoney(money.amount, money.currency)).join(" · ")
      return withCounts ? [bucket.label, bucket.count, balance] : [bucket.label, balance]
    }),
  }
}
