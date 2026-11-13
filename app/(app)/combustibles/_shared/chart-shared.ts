import { CHART_COLORS, CHART_SERIES } from "@/lib/chart-palette"

/**
 * Colores de los gráficos del control. Los medios de suministro son categorías
 * sin carga de alerta: se evita naranja/ámbar/rojo, reservados para fuera de
 * umbral, y «Sin medio informado» va en gris.
 */
export const MEDIUM_COLORS = CHART_SERIES

export const NO_MEDIUM_COLOR = CHART_COLORS.neutral

/** Medios más allá del sexto: un gris más claro que «Sin medio informado», nunca un color reciclado. */
export const OVERFLOW_MEDIUM_COLOR = "color-mix(in oklab, var(--color-chart-reference) 50%, var(--color-surface))"

/**
 * Color del medio `index` en orden: los seis primeros de la serie categórica, el resto en
 * gris (DESIGN.md § Gráficos: con más de 6 categorías no se recicla el color).
 */
export function mediumColor(label: string, index: number): string {
  if (label === "Sin medio informado") return NO_MEDIUM_COLOR
  return MEDIUM_COLORS[index] ?? OVERFLOW_MEDIUM_COLOR
}

export const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 11 } as const

/** 1.234.567 → "1,2 M"; 12.345 → "12,3 mil"; el resto, entero. Para ticks de eje. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} M`
  if (abs >= 10_000) return `${(value / 1_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} mil`
  return value.toLocaleString("es-CL", { maximumFractionDigits: 0 })
}
