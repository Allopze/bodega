/**
 * Paleta categórica única de **todos** los gráficos del producto.
 *
 * Vivía en `app/(app)/dashboard/` y convivía con otras dos (G-07); se movió a
 * `lib/` para que cualquier pantalla la consuma. Hasta la Fase 1 de la auditoría
 * de visualizaciones (2026-11-03) mezclaba tokens con ocho hex de Tailwind
 * (azul, violeta, rosa, índigo, cielo…) que no salían del mundo de la marca ni
 * tenían contraste verificado. Ahora **todo** es token: `--color-chart-1…6` y
 * `--color-chart-reference` en `app/globals.css`, con contraste ≥3:1 sobre
 * `surface` y `surface-2` (WCAG 1.4.11) comprobado por
 * `components/__tests__/design-tokens-contrast.test.ts`.
 *
 * Reglas (ver DESIGN.md § Gráficos):
 * - Un **estado** (cumple, vencido, pendiente, grave) usa los semánticos
 *   (`success`, `warning`, `danger`, `signal`), nunca la serie categórica.
 * - Una **categoría** sin semántica (faena, módulo, proveedor, medio) usa
 *   `CHART_SERIES` en orden. Son seis: con más, se resalta una y el resto va en
 *   `reference`, o se parte en small multiples; nunca se recicla el color.
 * - El **plan, la meta o el período anterior** —lo que se compara— va en
 *   `reference`.
 */
export const CHART_COLORS = {
  /** Verde esmeralda de marca — completado, positivo, la serie protagonista. */
  brand:   "var(--color-primary)",
  /** Naranja Chome — pendiente, en curso (semántico, no categórico). */
  signal:  "var(--color-signal)",
  /** Rojo del sistema — severidad, evento negativo (semántico). */
  danger:  "var(--color-danger)",
  /** Azul tinta (`--color-chart-2`). */
  blue:    "var(--color-chart-2)",
  /** Ocre (`--color-chart-3`). */
  amber:   "var(--color-chart-3)",
  /** Ciruela (`--color-chart-4`). */
  violet:  "var(--color-chart-4)",
  /** Verde azulado (`--color-chart-5`). */
  teal:    "var(--color-chart-5)",
  /** Pizarra oscura (`--color-chart-6`): sexta categoría. */
  slate:   "var(--color-chart-6)",
  /** Gris de referencia — plan, meta, acumulados, «sin dato»: lo que no es protagonista. */
  neutral: "var(--color-chart-reference)",
} as const

/**
 * Orden de asignación para series y barras categóricas sin semántica de alerta.
 * Seis tonos: el orden alterna matiz y luminancia para que dos vecinas nunca se
 * confundan (lo verifica la prueba de tokens).
 */
export const CHART_SERIES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
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
