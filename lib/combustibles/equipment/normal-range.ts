import { mean, sampleStdDev } from "@/lib/combustibles/control/calc/statistics"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { CV_ALERT_THRESHOLD, coefficientOfVariation } from "@/lib/combustibles/control/view-helpers"
import type { EquipmentNormalRange, EquipmentSeriesPoint } from "./types"

/**
 * Rango normal de un equipo: su promedio ± k desviaciones estándar muestrales,
 * la misma regla con la que el control marca una carga atípica
 * (`rendimiento_fuera_historico`). Sin suficientes cargas válidas no hay rango:
 * una franja inventada con tres puntos engañaría más de lo que ayuda.
 *
 * Con desviación cero tampoco hay rango: si todas las cargas valen 10,0, la
 * franja se reduce a un punto y la primera carga en 10,5 saldría «fuera de
 * rango» mientras el control —que exige `sd > 0`— la deja `ok` (hallazgo 3.7 de
 * la auditoría 2026-11-05). La regla es la de `calc/performance-series.ts`.
 */
export function computeNormalRange(values: readonly number[], k: number, minSamples: number): EquipmentNormalRange | null {
  if (values.length < Math.max(2, minSamples)) return null
  const avg = mean(values)
  const sd = sampleStdDev(values)
  if (avg === null || sd === null || !(sd > 0)) return null
  return { low: avg - k * sd, high: avg + k * sd, mean: avg, sd, samples: values.length, k }
}

/** km/L: rendimiento por debajo del rango es lo malo. L/h: por encima. */
export function isOutOfRange(unit: PerformanceUnit, value: number, range: Pick<EquipmentNormalRange, "low" | "high">): boolean {
  return unit === "km_per_liter" ? value < range.low : value > range.high
}

/**
 * Desde cuándo rinde fuera de su rango: la racha de puntos fuera de rango que
 * llega hasta la última carga. `null` si la última carga está dentro.
 */
export function outOfRangeRun(points: readonly Pick<EquipmentSeriesPoint, "occurredAt" | "outOfRange">[]): { at: string; count: number } | null {
  let count = 0
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (!points[index]!.outOfRange) break
    count += 1
  }
  return count === 0 ? null : { at: points[points.length - count]!.occurredAt, count }
}

/** «parejo» o «irregular» según la variación de sus cargas (CV > 25 %); `null` si no se puede calcular. */
export function regularityOf(meanValue: number | null, sd: number | null): { regularity: "parejo" | "irregular" | null; cv: number | null } {
  const cv = coefficientOfVariation(meanValue, sd)
  if (cv === null) return { regularity: null, cv: null }
  return { regularity: cv > CV_ALERT_THRESHOLD ? "irregular" : "parejo", cv }
}
