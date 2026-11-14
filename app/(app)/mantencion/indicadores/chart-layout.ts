/**
 * Reparto de anchos de los gráficos de una sección para que ningún `ChartSlot` deje media fila
 * huérfana ni a 2 columnas (`xl`) ni a 3 (`2xl`).
 *
 * `DashboardPanel` pone los gráficos en una grilla de 1, 2 y 3 columnas, y los anchos
 * (`ChartSlot span`) valen distinto en cada una:
 *
 *   one     1 / 1      wide    2 / 2      full    2 / 3      fillXl  2 / 1     (xl / 2xl)
 *
 * Qué gráficos se pintan depende de los datos (uno sin datos desaparece), así que los anchos no
 * pueden ser fijos: se eligen con los gráficos que de verdad van a aparecer. Cada celda declara
 * qué anchos admite y en qué orden los prefiere; se toma la combinación válida con menos
 * desviaciones de lo preferido. Una serie temporal nunca baja a una columna.
 */

export type ChartSpan = "one" | "wide" | "full" | "fillXl"
export type ChartCellKind = "series" | "compact"

const CANDIDATES: Record<ChartCellKind, readonly ChartSpan[]> = {
  series: ["wide", "full"],
  compact: ["one", "fillXl", "wide", "full"],
}

const UNITS: Record<ChartSpan, { xl: number; xxl: number }> = {
  one: { xl: 1, xxl: 1 },
  wide: { xl: 2, xxl: 2 },
  full: { xl: 2, xxl: 3 },
  fillXl: { xl: 2, xxl: 1 },
}

/** ¿Las celdas, en orden, llenan filas completas de `cols` columnas sin que ninguna se parta? */
export function fillsRows(spans: readonly ChartSpan[], cols: 2 | 3): boolean {
  let used = 0
  for (const span of spans) {
    const units = cols === 2 ? UNITS[span].xl : UNITS[span].xxl
    if (used + units > cols) return false
    used = (used + units) % cols
  }
  return used === 0
}

/** Anchos de las celdas visibles, en su orden. Sin combinación exacta, los anchos preferidos. */
export function chooseSpans(kinds: readonly ChartCellKind[]): ChartSpan[] {
  const preferred = kinds.map((kind) => CANDIDATES[kind][0]!)
  let best: { spans: ChartSpan[]; score: number } | null = null
  const walk = (index: number, spans: ChartSpan[], score: number) => {
    if (best && score >= best.score) return
    if (index === kinds.length) {
      if (fillsRows(spans, 2) && fillsRows(spans, 3)) best = { spans: [...spans], score }
      return
    }
    CANDIDATES[kinds[index]!].forEach((span, rank) => walk(index + 1, [...spans, span], score + rank))
  }
  walk(0, [], 0)
  return (best as { spans: ChartSpan[] } | null)?.spans ?? preferred
}
