/**
 * Marcado de atípicos sobre rendimientos, compartido por el detector de
 * anomalías y los tableros de consumo y operaciones. Funciones puras sobre
 * arreglos de números — el llamador es responsable de no mezclar observaciones
 * km/L con L/h antes de pasarlas aquí; esta capa no conoce unidades, sólo
 * calcula.
 *
 * Fórmulas:
 * - Desviación estándar: poblacional (÷ n), no muestral (÷ n-1). Se trabaja con
 *   el universo de cargas del período filtrado, no con una muestra de un
 *   universo mayor. (Las vistas de «Consumo y rendimiento» calculan la muestral
 *   en SQL con `stddev_samp`; ver `lib/combustibles/control/calc/statistics.ts`.)
 * - Atípico: fuera de media ± `outlierThresholdStdDevs` desviaciones estándar
 *   (por defecto 1.5 — mismo umbral que ya usaban `consumption-dashboard.ts` y
 *   `operations-dashboard.ts` antes de unificarse aquí).
 *
 * `percentile`, `median` y `coefficientOfVariation` se retiraron el 2026-10-22
 * junto con las vistas de análisis y reportes, que eran sus únicos usuarios.
 */

/** Mínimo de observaciones para considerar la muestra concluyente.
 *  ponytail: umbral fijo, ver sección 12 para hacerlo configurable. */
export const MIN_CONCLUSIVE_SAMPLE = 5

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export const DEFAULT_OUTLIER_THRESHOLD_STDDEVS = 1.5

/** Marca como atípico un valor fuera de media ± N desviaciones estándar del
 *  conjunto. Requiere al menos 3 observaciones válidas para ser significativo;
 *  con menos, sólo marca ceros como atípicos (nunca infiere de una muestra tan chica). */
export function flagOutliers<T>(
  rows: T[],
  valueOf: (row: T) => number,
  threshold: number = DEFAULT_OUTLIER_THRESHOLD_STDDEVS,
): Array<T & { atipico: boolean }> {
  const values = rows.map(valueOf).filter((v) => v > 0)
  if (values.length < 3) return rows.map((row) => ({ ...row, atipico: valueOf(row) === 0 }))
  const avg = mean(values)
  const stdDev = standardDeviation(values)
  return rows.map((row) => {
    const value = valueOf(row)
    return { ...row, atipico: value === 0 || Math.abs(value - avg) > threshold * stdDev }
  })
}
