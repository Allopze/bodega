import { bucketLabel, type DateRange, type IndicatorGranularity } from "@/lib/indicators/period"
import type { AlertGranularity } from "@/lib/services/fleet-gps-indicators"
import { formatDate, formatQty } from "@/lib/utils"

/**
 * Textos y cifras derivadas de los Indicadores GPS. Puras: las comparten el
 * servidor (secciones) y el navegador (gráficos).
 */

/** Variación porcentual contra el período anterior; `null` sin base de comparación. */
export function percentChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return ((current - previous) / previous) * 100
}

/** «01-11-2026 al 10-11-2026»: la ventana de un gráfico dicha con fechas del sistema. */
export function rangeText(range: DateRange): string {
  return `${formatDate(range.from)} al ${formatDate(range.to)}`
}

export function usageBucketLabel(key: string, granularity: IndicatorGranularity): string {
  return bucketLabel(key, granularity)
}

/** Rótulo de eje del balde de alertas: «9 nov» (lunes de la semana) o «nov 2026». */
export function alertBucketLabel(key: string, granularity: AlertGranularity): string {
  return granularity === "week" ? bucketLabel(key, "day") : bucketLabel(key, "month")
}

/** Rótulo largo para tooltip y tabla: «Semana del 9 nov». */
export function alertBucketTitle(key: string, granularity: AlertGranularity): string {
  return granularity === "week" ? `Semana del ${bucketLabel(key, "day")}` : bucketLabel(key, "month")
}

export function kmText(km: number): string {
  return `${formatQty(Math.round(km))} km`
}

export function hoursText(hours: number): string {
  return `${formatQty(hours, undefined, { maximumFractionDigits: hours >= 100 ? 0 : 1 })} h`
}
