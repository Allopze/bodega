import type { MantViewer } from "../access"
import {
  loadCorrectiveDrivers, loadCorrectiveEquipmentSeries, loadCorrectiveMonthly, loadCorrectiveStats, SERIES_LIMIT,
} from "./corrective-summary"
import type { CorrectiveStats, DriverRow, EquipmentSeriesRow, LookerContext, MonthlyCount } from "./types"

/**
 * Qué consulta la pestaña Correctivo y con qué filtros. La comparten la pantalla (`correctivo-tab.tsx`) y «Exportar
 * Excel», para que el libro traiga exactamente lo que la pantalla dibuja con los mismos filtros de la URL: la regla
 * «cada bloque ignora la dimensión que él mismo emite» vive en los cargadores de `corrective-summary.ts` y de la
 * tabla (`corrective.ts`), y esta función sólo los junta en paralelo.
 *
 * - Tira de cifras: todos los filtros.
 * - Horas y registros por equipo: ignora el equipo.
 * - Horas por conductor: ignora el conductor.
 * - Trabajos por mes: ignora el mes.
 * - Tabla: ignora la OT (la elige la propia fila).
 */

export interface CorrectiveTabOptions {
  /** Equipos de la serie de horas y registros (la exportación pide todos). */
  seriesLimit?: number
}

export interface CorrectiveTabData<TRows> {
  stats: CorrectiveStats
  series: EquipmentSeriesRow[]
  drivers: DriverRow[]
  monthly: MonthlyCount[]
  /** Las filas de la tabla: una página (la pantalla) o todas (el Excel), según `loadRows`. */
  rows: TRows
}

export async function loadCorrectiveTabData<TRows>(
  viewer: MantViewer,
  context: LookerContext,
  loadRows: () => Promise<TRows>,
  options: CorrectiveTabOptions = {},
): Promise<CorrectiveTabData<TRows>> {
  const { filters, cross } = context
  const [stats, series, drivers, monthly, rows] = await Promise.all([
    loadCorrectiveStats(viewer, filters, cross),
    loadCorrectiveEquipmentSeries(viewer, filters, cross, { limit: options.seriesLimit ?? SERIES_LIMIT }),
    loadCorrectiveDrivers(viewer, filters, cross),
    loadCorrectiveMonthly(viewer, filters, cross),
    loadRows(),
  ])
  return { stats, series, drivers, monthly, rows }
}
