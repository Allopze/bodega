/**
 * Estadística descriptiva reutilizable para rendimiento de equipos (sección 4).
 * Funciones puras sobre arreglos de números — el llamador es responsable de no
 * mezclar observaciones km/L con L/h antes de pasarlas aquí; esta capa no
 * conoce unidades, sólo calcula.
 *
 * Fórmulas:
 * - Desviación estándar: poblacional (÷ n), no muestral (÷ n-1). Se trabaja con
 *   el universo de cargas del período filtrado, no con una muestra de un
 *   universo mayor.
 * - Percentil: interpolación lineal (método "R-7", el mismo que Excel PERCENTILE
 *   y numpy por defecto) sobre el arreglo ordenado.
 * - Coeficiente de variación: stddev / |media|, en porcentaje. `null` si la
 *   media es 0 (indefinido).
 * - Atípico: fuera de media ± `outlierThresholdStdDevs` desviaciones estándar
 *   (por defecto 1.5 — mismo umbral que ya usaban `consumption-dashboard.ts` y
 *   `operations-dashboard.ts` antes de unificarse aquí).
 */

export interface DescriptiveStats {
  count: number
  mean: number
  median: number
  min: number
  max: number
  stdDev: number
  coefficientOfVariation: number | null
  p10: number
  p90: number
}

/** Mínimo de observaciones para considerar la muestra concluyente.
 *  ponytail: umbral fijo, ver sección 12 para hacerlo configurable. */
export const MIN_CONCLUSIVE_SAMPLE = 5

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** Percentil por interpolación lineal (0 ≤ p ≤ 100). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]!
  const weight = rank - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

export function coefficientOfVariation(values: number[]): number | null {
  const avg = mean(values)
  if (avg === 0) return null
  return round((standardDeviation(values) / Math.abs(avg)) * 100, 1)
}

export function describe(values: number[]): DescriptiveStats {
  return {
    count: values.length,
    mean: round(mean(values), 2),
    median: round(median(values), 2),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    stdDev: round(standardDeviation(values), 2),
    coefficientOfVariation: coefficientOfVariation(values),
    p10: round(percentile(values, 10), 2),
    p90: round(percentile(values, 90), 2),
  }
}

export type SampleReliability = "insuficiente" | "baja" | "confiable"

/** "Muestra no concluyente" (insuficiente) por debajo de `MIN_CONCLUSIVE_SAMPLE`;
 *  entre eso y el doble, confiabilidad "baja"; por sobre eso, "confiable". */
export function sampleReliability(count: number): SampleReliability {
  if (count < MIN_CONCLUSIVE_SAMPLE) return "insuficiente"
  if (count < MIN_CONCLUSIVE_SAMPLE * 2) return "baja"
  return "confiable"
}

/** Variación porcentual entre dos períodos. `null` si no hay base de comparación. */
export function periodVariation(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null
  return round(((current - previous) / previous) * 100, 1)
}

export interface TrendLine {
  /** Cambio de rendimiento por período (en la unidad original). */
  slope: number
  /** Bondad del ajuste (0–1). */
  r2: number
  direction: "up" | "down" | "flat"
}

/** Regresión lineal simple (OLS) sobre una serie de medias por período.
 *  `null` si hay menos de 2 puntos o todos los valores son idénticos (pendiente 0 exacta).
 *  La dirección es puramente estadística — no interpreta si subir es bueno o malo. */
export function linearTrend(means: number[]): TrendLine | null {
  if (means.length < 2) return null
  const n = means.length
  const yMean = mean(means)
  const xMean = (n - 1) / 2

  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const dx = i - xMean
    numerator += dx * (means[i]! - yMean)
    denominator += dx * dx
  }

  if (denominator === 0) return null
  const slope = numerator / denominator
  // Si la pendiente es esencialmente 0, no hay tendencia.
  if (Math.abs(slope) < 1e-6) return null

  const intercept = yMean - slope * xMean

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept
    ssRes += (means[i]! - predicted) ** 2
    ssTot += (means[i]! - yMean) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  const direction: TrendLine["direction"] = slope > 0 ? "up" : "down"

  return {
    slope: round(slope, 4),
    r2: round(Math.max(0, Math.min(1, r2)), 3),
    direction,
  }
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

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export interface HistogramBin {
  range: { from: number; to: number }
  label: string
  count: number
}

/** Agrupa valores en bins de igual ancho. El número de bins es orientativo —
 *  se ajusta para que los extremos sean legibles. */
export function histogram(values: number[], desiredBins = 10): HistogramBin[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  if (max === min) return [{ range: { from: min, to: min }, label: `${min}`, count: values.length }]

  const span = max - min
  const rawWidth = span / desiredBins
  const order = Math.pow(10, Math.floor(Math.log10(rawWidth)))
  const niceWidth = rawWidth / order >= 5 ? 5 * order : rawWidth / order >= 2 ? 2 * order : order
  const niceMin = Math.floor(min / niceWidth) * niceWidth
  const niceMax = Math.ceil(max / niceWidth) * niceWidth
  const bins: HistogramBin[] = []

  const count = Math.round((niceMax - niceMin) / niceWidth)
  for (let i = 0; i < count; i++) {
    const from = niceMin + i * niceWidth
    const to = from + niceWidth
    const label = i === count - 1 ? `${round(from, 1)}+` : `${round(from, 1)} – ${round(to, 1)}`
    bins.push({ range: { from, to }, label, count: 0 })
  }

  for (const v of values) {
    const idx = Math.min(Math.floor((v - niceMin) / niceWidth), bins.length - 1)
    if (idx >= 0) bins[idx]!.count++
  }

  return bins.filter((b) => b.count > 0)
}

