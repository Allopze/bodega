/**
 * Paleta categórica única de **todos** los gráficos del producto.
 *
 * Vivía en `app/(app)/dashboard/` y convivía con otras dos: `COLORS[6]` en
 * `analitica/analytics-charts.tsx` y tokens sueltos en los gráficos de
 * prevención. Tres paletas sin relación entre sí para el mismo producto (G-07).
 * Se movió a `lib/` para que cualquier pantalla la consuma sin importar desde
 * la carpeta de otra ruta.
 *
 * Antes había 58 literales hex repartidos entre `dashboard-charts.tsx` y
 * `operational-metrics-strip.tsx`, sin garantía de que dos series vecinas
 * fueran distinguibles (B-02). Aquí vive una sola vez.
 *
 * `brand`, `signal` y `danger` salen de los tokens del design system. Los cuatro
 * restantes son hues que el sistema no define y que hacen falta para separar
 * hasta siete series: la marca es verde + naranja + ámbar, tres tonos demasiado
 * cercanos entre sí para usarlos como categorías contiguas.
 *
 * Todos se leen sobre `--color-surface` (blanco) con contraste suficiente para
 * trazos de 2px y rellenos sólidos. No se usa `--color-rule` (casi negro): como
 * relleno macizo domina la tarjeta — para eso está `neutral`.
 */
export const CHART_COLORS = {
  /** Verde esmeralda de marca — completado, positivo. */
  brand:   "var(--color-primary)",
  /** Naranja Chome — pendiente, en curso. */
  signal:  "var(--color-signal)",
  /** Rojo del sistema — severidad, evento negativo. */
  danger:  "var(--color-danger)",
  blue:    "#2563eb",
  violet:  "#7c3aed",
  teal:    "#0891b2",
  /** Gris pizarra — acumulados y métricas de referencia, no protagonistas. */
  neutral: "#64748b",
} as const

/**
 * Orden de asignación para series sin semántica propia (p. ej. las barras de
 * "Distribución por módulo", donde el módulo no implica un color).
 */
export const CHART_SERIES = [
  CHART_COLORS.brand,
  CHART_COLORS.blue,
  CHART_COLORS.signal,
  CHART_COLORS.violet,
  CHART_COLORS.teal,
  CHART_COLORS.danger,
  CHART_COLORS.neutral,
] as const


/**
 * Estilo del tooltip de los gráficos que usan recharts directo (sin
 * `ChartContainer`).
 *
 * Había **cuatro copias** de esta función —combustibles, anomalías,
 * material-ambiental y analítica— y una ya había derivado: `/analitica` usaba
 * `8px` de radio y 12px de fuente contra `var(--radius)` y 13px de las otras
 * tres, así que su tooltip se veía distinto sin que nadie lo decidiera.
 */
export function chartTooltipStyle() {
  return {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",
    fontSize: "13px",
  }
}
