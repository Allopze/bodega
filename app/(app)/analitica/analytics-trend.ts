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

/**
 * Subtítulo con la ventana real: la serie no sigue el período elegido sino los 12
 * meses que terminan en el mes de `hasta`, y el lector tiene que saberlo. Si ese
 * último mes no está completo se dice, para que no se lea como una caída. Si algún
 * mes no tiene datos del proveedor de combustible también se nombra (C-4): el
 * hueco de la línea sin explicación se lee como un error del gráfico.
 */
export function monthlyTrendDescription(toDate: string, partial: boolean, months = 12): string {
  // Los meses sin datos del proveedor los nombra `CoverageNotice` bajo el gráfico: es el
  // único lugar de la plataforma que lo dice (A5), con la misma redacción que el Excel.
  const base = `Últimos ${months} meses hasta ${formatTrendMonth(toDate.slice(0, 7))}`
  return partial ? `${base} · el último mes es parcial` : base
}

/** Meses de la serie sin datos del proveedor de combustible (`fuelAmount: null`), en orden. */
export function fuelGapMonthKeys(rows: readonly SpendByMonthRow[]): string[] {
  return rows.filter((row) => row.fuelAmount === null).map((row) => row.month)
}

/** Fila del gráfico de áreas: el combustible es `null` donde el proveedor no tiene datos (la capa se corta). */
export interface AreaChartRow {
  month: string
  purchasingAmount: number
  fuelAmount: number | null
  partial: boolean
}

/**
 * Filas de la «Tendencia mensual de gasto» (áreas apiladas de compras + combustible, sin una
 * serie «Total»: es la suma de las dos capas y dibujarla repetía la cifra).
 *
 * Un mes sin datos del proveedor deja el combustible en `null` y no en 0: una capa que baja a
 * cero se lee como «no se compró combustible» (C-4). Sin permiso de costos de combustible la
 * serie no se mide, así que va en `null` para todos los meses y el gráfico no la dibuja.
 */
export function areaChartRows(rows: readonly SpendByMonthRow[], showFuel: boolean): AreaChartRow[] {
  return rows.map((row) => ({
    month: row.month,
    purchasingAmount: row.purchasingAmount,
    fuelAmount: showFuel ? row.fuelAmount : null,
    partial: row.partial,
  }))
}

/**
 * La frase que responde el gráfico: la ventana real y el mes completo de mayor gasto.
 *
 * Sólo compiten los meses **completos y con todos los datos**: el mes parcial tiene menos días
 * que los demás y un mes sin datos del proveedor suma únicamente las compras, así que cualquiera
 * de los dos «ganaría» o «perdería» por razones que no son de gasto. Si no queda ninguno, lo dice
 * en vez de elegir uno que no se puede comparar.
 */
export function monthlyTrendSummary(toDate: string, rows: readonly SpendByMonthRow[], formatMoney: (value: number) => string): string {
  if (rows.every((row) => row.totalAmount === 0)) return ""
  const description = monthlyTrendDescription(toDate, rows.at(-1)?.partial === true)
  const comparable = rows.filter((row) => !row.partial && row.fuelAmount !== null && row.totalAmount > 0)
  const peak = comparable.reduce<SpendByMonthRow | null>((top, row) => (top === null || row.totalAmount > top.totalAmount ? row : top), null)
  return peak
    ? `${description}. Mayor gasto en un mes completo: ${formatTrendMonth(peak.month)} (${formatMoney(peak.totalAmount)}).`
    : `${description}. Ningún mes completo tiene todos los datos para compararse.`
}

/** «Ver datos» de la tendencia: lo mismo que el gráfico, en una tabla. */
export function trendDataRows(
  rows: readonly SpendByMonthRow[],
  showFuel: boolean,
  formatMoney: (value: number) => string,
): { headers: string[]; rows: string[][] } {
  return {
    headers: showFuel ? ["Mes", "Compras", "Combustible", "Total"] : ["Mes", "Compras"],
    rows: rows.map((row) => {
      const month = row.partial ? `${formatTrendMonth(row.month)} (parcial)` : formatTrendMonth(row.month)
      if (!showFuel) return [month, formatMoney(row.purchasingAmount)]
      return [
        month,
        formatMoney(row.purchasingAmount),
        row.fuelAmount === null ? "Sin datos del proveedor" : formatMoney(row.fuelAmount),
        // Sin el combustible no hay total: sería sólo lo comprado, y un «total» menor justo donde falta un dato.
        row.fuelAmount === null ? "—" : formatMoney(row.totalAmount),
      ]
    }),
  }
}

/**
 * Fila del tooltip: `[valor, serie]`. Con `filterNull={false}` recharts entrega los
 * valores nulos, y aquí se dicen con palabras: omitir la fila o pintar «$0» es
 * justo lo que C-4 corrige.
 */
export function trendTooltipEntry(name: string, value: number | null, formatMoney: (value: number) => string): [string, string] {
  if (value === null) return [name === "Combustible" ? "Sin datos del proveedor" : "—", name]
  return [formatMoney(value), name]
}

/**
 * ¿El punto `index` tiene valor y sus dos vecinos no? Una serie sin `connectNulls` no dibuja un
 * tramo hacia un hueco, así que ese punto quedaría invisible: el último mes, tras un hueco,
 * desaparecía. Una serie de un solo punto no se marca: recharts ya lo dibuja.
 */
export function isIsolatedPoint(values: ReadonlyArray<number | null>, index: number): boolean {
  if (values.length < 2 || values[index] == null) return false
  return values[index - 1] == null && values[index + 1] == null
}
