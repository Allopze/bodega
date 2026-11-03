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
 * último mes no está completo se dice, para que no se lea como una caída.
 */
export function monthlyTrendDescription(toDate: string, partial: boolean, months = 12): string {
  const base = `Últimos ${months} meses hasta ${formatTrendMonth(toDate.slice(0, 7))}`
  return partial ? `${base} · el último mes es parcial` : base
}
