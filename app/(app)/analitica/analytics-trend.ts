import type { SpendByMonthRow } from "@/lib/services/analytics"
import { MONTH_LABELS } from "@/lib/utils"

/**
 * Texto de la «Tendencia mensual de gasto» (C-10). Vive aparte del servicio para
 * que lo importen la página y el gráfico cliente sin arrastrar el acceso a datos.
 */

/** `2026-10` → `oct-2026`: el mismo rótulo en el subtítulo, el eje y el tooltip. */
export function formatTrendMonth(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return monthKey
  const label = MONTH_LABELS[Number(match[2]) - 1]
  return label ? `${label.toLowerCase()}-${match[1]}` : monthKey
}

/**
 * `2026-10` → `oct-26`: el rótulo del eje. Con 12 puntos el rótulo largo no cabe y
 * Recharts descartaba meses alternos; el completo se conserva en el tooltip y el subtítulo.
 */
export function formatTrendMonthShort(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return monthKey
  const label = MONTH_LABELS[Number(match[2]) - 1]
  return label ? `${label.toLowerCase()}-${match[1]!.slice(2)}` : monthKey
}

/** `[2025-11, 2025-12, 2026-09]` → «nov-2025, dic-2025 y sep-2026»: los meses de un aviso, en una frase. */
export function formatTrendMonthList(monthKeys: readonly string[]): string {
  const names = monthKeys.map(formatTrendMonth)
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

/**
 * Subtítulo con la ventana real: la serie no sigue el período elegido sino los 12
 * meses que terminan en el mes de `hasta`, y el lector tiene que saberlo. Si ese
 * último mes no está completo se dice, para que no se lea como una caída. Si algún
 * mes no tiene datos del proveedor de combustible también se nombra (C-4): el
 * hueco de la línea sin explicación se lee como un error del gráfico.
 */
export function monthlyTrendDescription(toDate: string, partial: boolean, fuelGapMonths: readonly string[] = [], months = 12): string {
  const base = `Últimos ${months} meses hasta ${formatTrendMonth(toDate.slice(0, 7))}`
  const withPartial = partial ? `${base} · el último mes es parcial` : base
  if (fuelGapMonths.length === 0) return withPartial
  return `${withPartial} · sin datos del proveedor de combustible en ${formatTrendMonthList(fuelGapMonths)}`
}

/** Meses de la serie sin datos del proveedor de combustible (`fuelAmount: null`), en orden. */
export function fuelGapMonthKeys(rows: readonly SpendByMonthRow[]): string[] {
  return rows.filter((row) => row.fuelAmount === null).map((row) => row.month)
}

/** Fila del gráfico: el total y el combustible pueden ser `null` (un hueco en la línea). */
export interface TrendChartRow {
  month: string
  purchasingAmount: number
  fuelAmount: number | null
  totalAmount: number | null
  partial: boolean
}

/**
 * Filas del gráfico. En un mes sin datos del proveedor el total también es `null`:
 * es sólo lo comprado, y dibujarlo como «Total» pintaría una caída que no ocurrió
 * justo donde el combustible no se conoce.
 */
export function trendChartRows(rows: readonly SpendByMonthRow[]): TrendChartRow[] {
  return rows.map((row) => ({ ...row, totalAmount: row.fuelAmount === null ? null : row.totalAmount }))
}

/**
 * Fila del tooltip: `[valor, serie]`. Con `filterNull={false}` recharts entrega los
 * valores nulos, y aquí se dicen con palabras: omitir la fila o pintar «$0» es
 * justo lo que C-4 corrige.
 */
export function trendTooltipEntry(name: string, value: number | null, formatMoney: (value: number) => string): [string, string] {
  const label = name === "totalAmount" ? "Total" : name
  if (value === null) {
    if (label === "Combustible") return ["Sin datos del proveedor", label]
    if (label === "Total") return ["Sin total: falta el combustible", label]
    return ["—", label]
  }
  return [formatMoney(value), label]
}

/**
 * ¿El punto `index` tiene valor y sus dos vecinos no? Una línea sin `connectNulls`
 * no dibuja un tramo hacia un hueco, así que ese punto quedaría invisible (con
 * `dot={false}`): el último mes, tras un hueco, desaparecía. Una serie de un solo
 * punto no se marca: recharts ya lo dibuja.
 */
export function isIsolatedPoint(values: ReadonlyArray<number | null>, index: number): boolean {
  if (values.length < 2 || values[index] == null) return false
  return values[index - 1] == null && values[index + 1] == null
}
