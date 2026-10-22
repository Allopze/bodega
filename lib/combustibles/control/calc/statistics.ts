import { formatQty } from "@/lib/utils"
import { STAT_MISSING } from "../contracts"

/**
 * Estadística del control de rendimiento. A diferencia de
 * `lib/combustibles/performance-statistics.ts` (desviación poblacional), aquí la
 * desviación es MUESTRAL (÷ n−1), la misma que `stddev_samp` en las vistas: las
 * cargas de un equipo son una muestra de su comportamiento, no el universo. Con
 * menos de dos valores no hay desviación (null → «—»), nunca 0.
 */

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const avg = mean(values)!
  let squares = 0
  for (const value of values) squares += (value - avg) ** 2
  return Math.sqrt(squares / (values.length - 1))
}

/** Cifra de estadística para mostrar: es-CL con `digits` decimales, o «—» si no se puede calcular. */
export function formatStat(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return STAT_MISSING
  return formatQty(value, undefined, { maximumFractionDigits: digits })
}
