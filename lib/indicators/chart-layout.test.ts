import { describe, expect, it } from "vitest"
import { layoutChartSlots, unusedColumns, type SlotKind } from "./chart-layout"

const WIDTHS = { one: [1, 1], wide: [2, 2], fillXl: [2, 1], full: [2, 3] } as const

/** Columnas sobrantes de un reparto en ambos cortes (xl = 2 columnas, 2xl = 3). */
function gaps(kinds: SlotKind[]) {
  const spans = layoutChartSlots(kinds)
  return {
    spans,
    xl: unusedColumns(spans.map((span) => WIDTHS[span][0]), 2),
    wide: unusedColumns(spans.map((span) => WIDTHS[span][1]), 3),
  }
}

describe("unusedColumns", () => {
  it("cuenta las columnas que quedan vacías", () => {
    expect(unusedColumns([1], 2)).toBe(1)
    expect(unusedColumns([2, 1], 3)).toBe(0)
    expect(unusedColumns([1, 2], 3)).toBe(0)
    expect(unusedColumns([1, 2], 2)).toBe(1) // el 2 no cabe junto al 1: deja una columna vacía
    expect(unusedColumns([2, 2, 1, 1], 3)).toBe(3)
  })
})

describe("layoutChartSlots", () => {
  it("sin celdas no hay reparto", () => {
    expect(layoutChartSlots([])).toEqual([])
  })

  it("en xl (el escritorio habitual) nunca deja huecos", () => {
    const sections: SlotKind[][] = [
      ["one"], ["one", "one"], ["one", "one", "one"], ["one", "one", "one", "one"], ["one", "one", "one", "one", "one"],
      ["wide", "one", "one", "one"], ["wide", "one"], ["wide"], ["one", "wide", "wide", "one"], ["one", "wide"],
    ]
    for (const kinds of sections) expect(gaps(kinds).xl, kinds.join(",")).toBe(0)
  })

  it("cuatro gráficos van de a dos en xl: no se ensanchan a fila completa por cuadrar 2xl", () => {
    expect(layoutChartSlots(["one", "one", "one", "one"])).toEqual(["one", "one", "one", "one"])
  })

  it("con tres, el último cierra la fila en xl sin romper la de 2xl", () => {
    expect(layoutChartSlots(["one", "one", "one"])).toEqual(["one", "one", "fillXl"])
    expect(gaps(["one", "one", "one"]).wide).toBe(0)
  })

  it("uno solo ocupa todo el ancho", () => {
    expect(layoutChartSlots(["one"])).toEqual(["full"])
  })

  it("una celda ancha seguida de una simple abre la simple a la fila en xl", () => {
    expect(layoutChartSlots(["wide", "one"])).toEqual(["wide", "fillXl"])
  })

  it("el ralentí solo junto a viajes ancho ocupa la fila en xl", () => {
    expect(layoutChartSlots(["one", "wide"])[0]).toBe("fillXl")
  })
})
