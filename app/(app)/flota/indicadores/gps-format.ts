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

/**
 * El balde con el mayor valor, sin contar los parciales (el último balde, aún en
 * curso, siempre pierde contra uno cerrado y se leería como un récord falso).
 * `null` si no queda ningún balde cerrado con valor mayor que cero. En un empate
 * gana el primero.
 */
export function peakBucket<T extends { partial?: boolean }>(
  points: readonly T[],
  valueOf: (point: T) => number | null,
): { point: T; value: number } | null {
  let best: { point: T; value: number } | null = null
  for (const point of points) {
    if (point.partial === true) continue
    const value = valueOf(point)
    if (value === null || !Number.isFinite(value) || value <= 0) continue
    if (best === null || value > best.value) best = { point, value }
  }
  return best
}

/** «en oct 2026» (mes) o «el 3 nov» (día): el complemento de «km …, el mes de más recorrido». */
export function peakPhrase(label: string, granularity: IndicatorGranularity): string {
  return granularity === "month" ? `en ${label}` : `el ${label}`
}

/**
 * ¿La cobertura del período anterior alcanza para comparar? Una variación como
 * «↑ 482 %» sólo dice que el período anterior casi no tenía datos (la integración
 * recién se conectó, una fuente estuvo caída), no que el uso se disparó. Se compara
 * cuando el anterior tiene al menos `minRatio` de la cobertura del actual.
 * `coverage` es cualquier cuenta de presencia de datos en la misma unidad en
 * ambos períodos (días con lecturas, horas de funcionamiento…).
 */
export function hasComparableBase(current: number, previous: number, minRatio = 0.5): boolean {
  if (!(previous > 0)) return false
  return previous >= current * minRatio
}

export const NO_COMPARABLE_BASE = "Sin base comparable en el período anterior"
