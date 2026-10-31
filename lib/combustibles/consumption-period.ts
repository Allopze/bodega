import { monthKeysBetween } from "./period/parse"
import type { ResolvedFuelPeriod } from "./period/types"
import { shiftPlainDateByMonths } from "./control/view-helpers"

/** Cuántos meses de historia muestran los gráficos «mes a mes» cuando el período es corto. */
export const CONSUMPTION_HISTORY_MONTHS = 6

export interface ConsumptionChartWindow {
  /** Rango civil inclusivo de lo que dibujan los gráficos mensuales. */
  from: string
  to: string
  /** Meses «YYYY-MM» que cubre, en orden. */
  monthKeys: string[]
  /** `true` cuando el gráfico muestra más que el período (para rotularlo). */
  isHistory: boolean
}

/**
 * Ventana de los gráficos «mes a mes» de Consumo. Un mes, una semana o un rango
 * corto dibujarían una sola barra: no dice si el mes fue alto o bajo. Con menos
 * de 3 meses de período se muestran los últimos 6 meses terminando donde
 * termina el período (y la pantalla lo rotula); un trimestre, un año o un rango
 * largo se dibujan tal cual. Las cifras y listas de la pantalla siguen usando
 * la ventana del período, no ésta.
 */
export function consumptionChartWindow(period: Pick<ResolvedFuelPeriod, "from" | "to" | "monthKeys">, monthsBack = CONSUMPTION_HISTORY_MONTHS): ConsumptionChartWindow {
  if (period.monthKeys.length >= 3) {
    return { from: period.from, to: period.to, monthKeys: period.monthKeys, isHistory: false }
  }
  const lastMonth = period.monthKeys[period.monthKeys.length - 1] ?? period.to.slice(0, 7)
  const from = shiftPlainDateByMonths(`${lastMonth}-01`, -(monthsBack - 1))
  return { from, to: period.to, monthKeys: monthKeysBetween(from, period.to), isHistory: true }
}
