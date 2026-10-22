import { CHART_COLORS } from "@/lib/chart-palette"

/**
 * Colores de los gráficos del control. Los medios de suministro son categorías
 * sin carga de alerta: se evita naranja/ámbar/rojo, reservados para fuera de
 * umbral, y «Sin medio informado» va en gris.
 */
export const MEDIUM_COLORS = [
  CHART_COLORS.brand,
  CHART_COLORS.blue,
  CHART_COLORS.violet,
  CHART_COLORS.teal,
  CHART_COLORS.indigo,
  CHART_COLORS.sky,
  CHART_COLORS.rose,
] as const

export const NO_MEDIUM_COLOR = CHART_COLORS.neutral

export const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 11 } as const

/** 1.234.567 → "1,2 M"; 12.345 → "12,3 mil"; el resto, entero. Para ticks de eje. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} M`
  if (abs >= 10_000) return `${(value / 1_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} mil`
  return value.toLocaleString("es-CL", { maximumFractionDigits: 0 })
}
