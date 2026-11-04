import { getOperationalCalendarBounds } from "@/lib/services/operational-period-bounds"
import { addDaysToPlainDate } from "@/lib/utils"

/**
 * Período de `/reportes` (CHART-032). La pantalla era un histórico sin fechas; ahora mide un período
 * con su comparación. Las ventanas son **las del tablero** (`getOperationalCalendarBounds`): mes,
 * trimestre o año calendario y el inmediatamente anterior, de modo que «OC emitidas» de acá y de
 * Finanzas dan lo mismo para el mismo rótulo.
 *
 * «Todo» es el histórico de antes y no tiene comparación: sin período anterior no se inventa una
 * variación.
 */

export const REPORT_PERIODS = [
  { value: "mes", label: "Mes" },
  { value: "trimestre", label: "Trimestre" },
  { value: "anio", label: "Año" },
  { value: "todo", label: "Todo" },
] as const

export type ReportPeriod = (typeof REPORT_PERIODS)[number]["value"]

export const DEFAULT_REPORT_PERIOD: ReportPeriod = "mes"

export function parseReportPeriod(value: string | string[] | undefined): ReportPeriod {
  const first = Array.isArray(value) ? value[0] : value
  return REPORT_PERIODS.find((period) => period.value === first)?.value ?? DEFAULT_REPORT_PERIOD
}

/** Una ventana `[start, end)`: instantes ISO para columnas `timestamptz`, claves de día para columnas de texto. */
export interface ReportWindow {
  start: string
  end: string
  startKey: string
  endKey: string
}

const toWindow = (start: string, end: string): ReportWindow => ({ start, end, startKey: start.slice(0, 10), endKey: end.slice(0, 10) })

export function reportWindows(period: ReportPeriod, now: Date = new Date()): { current: ReportWindow | null; previous: ReportWindow | null } {
  if (period === "todo") return { current: null, previous: null }
  const bounds = getOperationalCalendarBounds(now, period)
  return {
    current: toWindow(bounds.currentStart, bounds.currentEnd),
    previous: toWindow(bounds.previousStart, bounds.previousEnd),
  }
}

/**
 * Parámetros de URL que hacen que una lista (Solicitudes, Compras) reproduzca lo que cuenta la cifra:
 * el período y la faena elegidos. Las listas toman `hasta` INCLUSIVO y la ventana termina en un día
 * exclusivo, así que se resta uno.
 */
export function listWindowParams(window: ReportWindow | null, worksiteId: string | undefined): Record<string, string> {
  return {
    ...(window ? { desde: window.startKey, hasta: addDaysToPlainDate(window.endKey, -1) } : {}),
    ...(worksiteId ? { faena: worksiteId } : {}),
  }
}
