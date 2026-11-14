import { consumptionChartWindow, type ConsumptionChartWindow } from "@/lib/combustibles/consumption-period"
import { deltaPct, type MonthlyMediumChartData } from "@/lib/combustibles/control/view-helpers"
import { describeFuelPeriod, monthKeysBetween } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import type { FuelMonthlyPoint } from "@/lib/services/dashboard-fuel"
import { MONTH_LABELS, MONTH_NAMES, countOf, formatCLP, formatQty } from "@/lib/utils"

/**
 * Lo que «Indicadores de combustible» decide fuera de las consultas, en funciones puras
 * para poder probarlo sin base de datos ni SVG: qué ventanas pide cada bloque, cómo se
 * compara el costo con el período anterior y cómo se rotulan los meses.
 */

/** Tope de la ventana del libro del proveedor: un rango largo no dispara una consulta de años. */
export const MAX_LEDGER_MONTHS = 36

export interface IndicatorWindows {
  /**
   * Ventana de los gráficos mes a mes: la de Consumo (`consumptionChartWindow`). Con menos de
   * 3 meses de período, los últimos 6 meses terminando donde termina el período; con un
   * trimestre, un año o un rango largo, el período tal cual.
   */
  chart: ConsumptionChartWindow
  /** El período anterior del mismo tipo y largo; `null` si no existe. */
  previous: ResolvedFuelPeriod | null
  /** Mes final de la ventana del libro del proveedor. */
  ledgerLastMonth: string
  /** Meses que cubre: los de los gráficos y los del período anterior (para comparar el costo). */
  ledgerMonths: number
}

export function indicatorWindows(period: ResolvedFuelPeriod): IndicatorWindows {
  const chart = consumptionChartWindow(period)
  const previous = period.prev ? describeFuelPeriod(period.prev, period.source) : null
  const ledgerLastMonth = chart.monthKeys[chart.monthKeys.length - 1] ?? period.to.slice(0, 7)
  const firstChart = chart.monthKeys[0] ?? ledgerLastMonth
  const firstPrevious = previous?.monthKeys[0]
  const first = firstPrevious && firstPrevious < firstChart ? firstPrevious : firstChart
  const ledgerMonths = Math.min(MAX_LEDGER_MONTHS, monthKeysBetween(`${first}-01`, `${ledgerLastMonth}-01`).length)
  return { chart, previous, ledgerLastMonth, ledgerMonths }
}

/** «Últimos 6 meses, hasta octubre de 2026» o, si la ventana es el propio período, su rótulo. */
export function windowCaption(chart: ConsumptionChartWindow, period: Pick<ResolvedFuelPeriod, "label">): string {
  if (!chart.isHistory) return period.label
  const last = chart.monthKeys[chart.monthKeys.length - 1]
  const [year, month] = (last ?? "").split("-")
  const name = MONTH_NAMES[Number(month) - 1]
  return name && year ? `Últimos ${chart.monthKeys.length} meses, hasta ${name} de ${year}` : `Últimos ${chart.monthKeys.length} meses`
}

/* ── Costo del período (libro del proveedor, mensual) ─────────────────────── */

export interface LedgerCost {
  /** `null`: sin `combustibles:view_costs`, o todos los meses sin datos del proveedor. */
  amount: number | null
  liters: number | null
  /** Variación contra el período anterior; `null` si no es comparable (ver `ledgerCost`). */
  pct: number | null
  /** Meses del período sin datos del proveedor: no suman y el aviso de cobertura los nombra. */
  gapMonths: string[]
}

function sumMonths(points: readonly FuelMonthlyPoint[], monthKeys: readonly string[]) {
  const wanted = new Set(monthKeys)
  const inScope = points.filter((point) => wanted.has(point.monthKey))
  const covered = inScope.filter((point) => !point.providerGap)
  const gapMonths = inScope.filter((point) => point.providerGap).map((point) => point.monthKey)
  const amounts = covered.map((point) => point.amount)
  return {
    covered: covered.length,
    gapMonths,
    amount: covered.length > 0 && amounts.every((amount) => amount !== null) ? amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) : null,
    liters: covered.length > 0 ? covered.reduce((sum, point) => sum + (point.liters ?? 0), 0) : null,
  }
}

/**
 * Costo (y litros) del libro del proveedor de los meses del período y su variación contra
 * los del período anterior. El libro es mensual: con una semana o un rango se toman los
 * meses completos que el período toca (la pantalla lo dice).
 *
 * La variación sólo se calcula cuando es honesta:
 * - un período en curso no se compara con uno completo (parecería un desplome);
 * - un mes sin datos del proveedor en cualquiera de los dos lados deja la comparación sin
 *   base, y un hueco no es un cero;
 * - sin período anterior o con costo anterior 0 no hay con qué.
 */
export function ledgerCost(points: readonly FuelMonthlyPoint[], period: ResolvedFuelPeriod, previous: ResolvedFuelPeriod | null): LedgerCost {
  const now = sumMonths(points, period.monthKeys)
  let pct: number | null = null
  // El libro es mensual: una semana o un rango toman los meses que tocan, y dos semanas del mismo
  // mes comparan ese mes consigo mismo. Sólo se compara entre períodos de meses completos.
  if (period.status !== "en_curso" && period.isWholeMonths && previous?.isWholeMonths && now.amount !== null) {
    const before = sumMonths(points, previous.monthKeys)
    const comparable = before.gapMonths.length === 0 && before.covered === previous.monthKeys.length && now.gapMonths.length === 0
    if (comparable) {
      const value = deltaPct(now.amount, before.amount)
      pct = value === null ? null : Math.round(value)
    }
  }
  return { amount: now.amount, liters: now.liters, pct, gapMonths: now.gapMonths }
}

/* ── Puntos de los gráficos ───────────────────────────────────────────────── */

/**
 * Rótulo de eje de cada mes: «Sep». Si la ventana repite un mes (más de 12 meses) lleva el
 * año, «Sep 25», para que dos barras no se llamen igual.
 */
export function monthAxisLabels(monthKeys: readonly string[]): string[] {
  const short = monthKeys.map((key) => MONTH_LABELS[Number(key.slice(5, 7)) - 1] ?? key)
  const repeated = new Set(short).size !== short.length
  return monthKeys.map((key, index) => (repeated ? `${short[index]} ${key.slice(2, 4)}` : (short[index] ?? key)))
}

export interface CostPricePoint {
  /** Rótulo del eje («Sep»). */
  month: string
  monthKey: string
  /** Costo del mes en el libro del proveedor; `null` en un mes sin datos (hueco, no cero) o sin permiso de costos. */
  amount: number | null
  /** Costo ÷ litros del libro (CLP/L); `null` si falta cualquiera de los dos. Los litros del libro no se muestran: sólo sirven para este precio. */
  price: number | null
  providerGap: boolean
  partial: boolean
}

/** Los puntos del libro que caen en la ventana del gráfico, en orden, con su rótulo y su precio por litro. */
export function ledgerChartPoints(points: readonly FuelMonthlyPoint[], monthKeys: readonly string[]): CostPricePoint[] {
  const byKey = new Map(points.map((point) => [point.monthKey, point]))
  const labels = monthAxisLabels(monthKeys)
  return monthKeys.flatMap((monthKey, index) => {
    const point = byKey.get(monthKey)
    if (!point) return []
    const price = !point.providerGap && point.amount !== null && point.liters !== null && point.liters > 0 ? point.amount / point.liters : null
    return [{
      month: labels[index] ?? monthKey,
      monthKey,
      amount: point.amount,
      price,
      providerGap: point.providerGap,
      partial: point.partial,
    }]
  })
}

/** ¿Algún mes trae costo? Sin eso el gráfico de costo no se dibuja. */
export function ledgerHasCost(points: readonly CostPricePoint[]): boolean {
  return points.some((point) => (point.amount ?? 0) > 0)
}

export interface PriceSummary {
  /** Precio medio por litro de la ventana (Σcosto ÷ Σlitros de los meses con ambos); `null` sin ninguno. */
  average: number | null
  last: { monthKey: string; price: number } | null
  previous: { monthKey: string; price: number } | null
  /** Variación del último mes completo contra el anterior, en %; `null` si no se pueden comparar. */
  pct: number | null
}

/**
 * Resumen del precio por litro. El promedio usa la razón de sumas (no el promedio de los
 * precios mensuales: un mes chico pesaría como uno grande). La variación compara el último
 * mes completo con el anterior que tenga precio; el mes en curso no entra: sus pocos días
 * no son un precio del mes.
 */
export function priceSummary(points: readonly FuelMonthlyPoint[], windowKeys: readonly string[]): PriceSummary {
  const wanted = new Set(windowKeys)
  const inWindow = points.filter((point) => wanted.has(point.monthKey))
  const priced = inWindow.filter((point) => !point.providerGap && point.amount !== null && point.liters !== null && point.liters > 0)
  const amount = priced.reduce((sum, point) => sum + (point.amount ?? 0), 0)
  const liters = priced.reduce((sum, point) => sum + (point.liters ?? 0), 0)
  const complete = priced.filter((point) => !point.partial).map((point) => ({ monthKey: point.monthKey, price: (point.amount ?? 0) / (point.liters ?? 1) }))
  const last = complete[complete.length - 1] ?? null
  const previous = complete[complete.length - 2] ?? null
  const pct = last && previous ? deltaPct(last.price, previous.price) : null
  return { average: liters > 0 ? amount / liters : null, last, previous, pct: pct === null ? null : Math.round(pct) }
}

const monthName = (monthKey: string) => MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] ?? monthKey

/** Titular del gráfico de costo: el precio medio por litro y, si se puede, cómo cambió el último mes. `null` sin precio. */
export function priceHeadline(summary: PriceSummary): { value: string; caption: string } | null {
  if (summary.average === null) return null
  const base = "precio medio por litro en la ventana"
  if (!summary.last || !summary.previous || summary.pct === null) return { value: `${formatCLP(Math.round(summary.average))}/L`, caption: base }
  const change = summary.pct === 0
    ? `igual que en ${monthName(summary.previous.monthKey)}`
    : `${formatQty(Math.abs(summary.pct))} % ${summary.pct > 0 ? "más" : "menos"} que en ${monthName(summary.previous.monthKey)}`
  return { value: `${formatCLP(Math.round(summary.average))}/L`, caption: `${base} · en ${monthName(summary.last.monthKey)}, ${change}` }
}

/* ── «Ver datos» ──────────────────────────────────────────────────────────── */

const MISSING = "—"
const liters = (value: number | null) => (value === null ? MISSING : formatQty(value, undefined, { maximumFractionDigits: 0 }))

export function costPriceTable(points: readonly CostPricePoint[]): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Mes", "Costo", "Precio por litro", "Observación"],
    rows: points.map((point) => [
      `${MONTH_NAMES[Number(point.monthKey.slice(5, 7)) - 1] ?? point.monthKey} ${point.monthKey.slice(0, 4)}`.replace(/^./, (c) => c.toUpperCase()),
      point.amount === null ? MISSING : formatCLP(point.amount),
      point.price === null ? MISSING : formatCLP(Math.round(point.price)),
      point.providerGap ? "Sin datos del proveedor" : point.partial ? "Mes en curso" : MISSING,
    ]),
  }
}

export function mediumTable(data: MonthlyMediumChartData): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Mes", ...data.series.map((item) => item.label), "Total"],
    rows: data.points.map((point) => [
      point.fullLabel,
      ...data.series.map((item) => liters(Number(point[item.key] ?? 0))),
      liters(point.total),
    ]),
  }
}

export interface IdleMonth {
  month: string
  litersIdle: number | null
  idleLitersPct: number | null
}

export function idleTable(rows: readonly (IdleMonth & { label: string })[]): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Mes", "Litros en vacío", "% de los litros informados"],
    rows: rows.map((row) => [
      row.label,
      liters(row.litersIdle),
      row.idleLitersPct === null ? MISSING : `${formatQty(row.idleLitersPct, undefined, { maximumFractionDigits: 1 })} %`,
    ]),
  }
}

/** Litros en vacío de toda la ventana y su % de los litros informados; `null` si ningún mes trae litros. */
export function idleWindowTotals(rows: readonly (IdleMonth & { litersWorking: number | null })[]): { litersIdle: number; pct: number | null } | null {
  const known = rows.filter((row) => row.litersIdle !== null)
  if (known.length === 0) return null
  const litersIdle = known.reduce((sum, row) => sum + (row.litersIdle ?? 0), 0)
  const both = known.filter((row) => row.litersWorking !== null)
  const base = both.reduce((sum, row) => sum + (row.litersWorking ?? 0) + (row.litersIdle ?? 0), 0)
  const idleOfBoth = both.reduce((sum, row) => sum + (row.litersIdle ?? 0), 0)
  return { litersIdle, pct: base > 0 ? (idleOfBoth / base) * 100 : null }
}

/* ── Rankings ─────────────────────────────────────────────────────────────── */

/** «Faena X, 42 % del total»: la conclusión de un ranking de litros, o `null` sin litros. */
export function topShare(items: readonly { label: string; value: number }[]): { label: string; value: number; sharePct: number } | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  const top = [...items].sort((a, b) => b.value - a.value)[0]
  if (!top || total <= 0) return null
  return { label: top.label, value: top.value, sharePct: (top.value / total) * 100 }
}

export const equipmentCount = (count: number) => countOf(count, "equipo", "equipos")
