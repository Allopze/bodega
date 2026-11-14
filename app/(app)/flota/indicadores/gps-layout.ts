/**
 * Reparto de las celdas de un panel de gráficos sin huecos en la grilla.
 *
 * `DashboardPanel cols="charts"` tiene 1 columna, 2 en `xl` y 3 en `2xl`, y
 * `ChartSlot` ofrece cuatro anchos `[xl, 2xl]`: `one` [1,1], `wide` [2,2],
 * `fillXl` [2,1] y `full` [2,3]. Con un orden fijo de celdas, una de ellas que se
 * oculta (un ranking con una sola faena, un gráfico sin datos) deja a su vecina
 * sola en una fila a medias. Como cuáles celdas existen se sabe en el servidor, se
 * elige el ancho de cada una simulando el flujo de la grilla (sin `dense`) hasta
 * que no sobre ninguna columna en ninguno de los dos cortes.
 */

export type SlotKind = "one" | "wide"
export type SlotSpan = "one" | "wide" | "fillXl" | "full"

const WIDTHS: Record<SlotSpan, readonly [number, number]> = { one: [1, 1], wide: [2, 2], fillXl: [2, 1], full: [2, 3] }
/** Opciones por tipo, de la más fiel a la que más se aparta; el costo es su posición. */
const OPTIONS: Record<SlotKind, readonly SlotSpan[]> = { one: ["one", "fillXl", "full"], wide: ["wide", "full"] }
const COLUMNS = [2, 3] as const

/** Columnas sin ocupar de una grilla de `columns` donde las celdas entran en orden. */
export function unusedColumns(widths: readonly number[], columns: number): number {
  let used = 0
  let unused = 0
  for (const width of widths) {
    const span = Math.min(width, columns)
    if (used + span > columns) {
      unused += columns - used
      used = 0
    }
    used += span
    if (used === columns) used = 0
  }
  return unused + (used > 0 ? columns - used : 0)
}

export function layoutChartSlots(kinds: readonly SlotKind[]): SlotSpan[] {
  const count = kinds.length
  if (count === 0) return []
  let best: { spans: SlotSpan[]; gaps: number; cost: number } | null = null
  const walk = (index: number, spans: SlotSpan[], cost: number) => {
    if (index === count) {
      const gaps = COLUMNS.reduce((sum, columns, at) => sum + unusedColumns(spans.map((span) => WIDTHS[span][at]!), columns), 0)
      if (best === null || gaps < best.gaps || (gaps === best.gaps && cost < best.cost)) best = { spans: [...spans], gaps, cost }
      return
    }
    OPTIONS[kinds[index]!].forEach((span, position) => {
      spans.push(span)
      walk(index + 1, spans, cost + position)
      spans.pop()
    })
  }
  walk(0, [], 0)
  return (best as { spans: SlotSpan[] } | null)?.spans ?? kinds.map((kind) => OPTIONS[kind][0]!)
}
