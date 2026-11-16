import type { IndicatorGranularity } from "./period"

/**
 * El titular de un gráfico en reposo nombra el balde con más («…en oct 2026, el período con
 * más»). El balde en curso no compite por ese lugar: un mes a medias no es un récord. Pero si
 * el mes en curso YA supera a todos los cerrados, callarlo deja un titular que contradice la
 * barra más alta del gráfico: la crítica de Control operacional (2026-11-15, paso 5) vio
 * «23,8 días fuera de servicio en oct, el período con más» junto a una barra de noviembre de
 * ~58. Este helper dice cuándo pasa, para que el titular lo diga.
 *
 * Lo usan el Panel de mantención y los Indicadores GPS, cada uno con su propio cálculo del
 * mayor cerrado (empates, ceros), que no cambia.
 */
export function ongoingAbovePeak<T extends { partial?: boolean }>(
  points: readonly T[],
  valueOf: (point: T) => number | null,
): { point: T; value: number } | null {
  const ongoing = [...points].reverse().find((point) => point.partial === true)
  if (!ongoing) return null
  const value = valueOf(ongoing)
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  const closed = points.filter((point) => point.partial !== true).map(valueOf).filter((item): item is number => item !== null && Number.isFinite(item))
  // Sin baldes cerrados no hay contra qué comparar: cada gráfico decide qué decir con uno solo.
  if (closed.length === 0) return null
  return value > Math.max(...closed) ? { point: ongoing, value } : null
}

const PLURAL: Record<IndicatorGranularity, string> = { day: "días", month: "meses" }

/** «, que sigue en curso y ya supera a todos los meses anteriores del gráfico»: el cierre del titular. */
export function ongoingPeakClause(granularity: IndicatorGranularity): string {
  return `, que sigue en curso y ya supera a todos los ${PLURAL[granularity]} anteriores del gráfico`
}
