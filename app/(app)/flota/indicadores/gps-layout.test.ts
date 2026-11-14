import { describe, expect, it } from "vitest"
import { layoutChartSlots, unusedColumns, type SlotKind } from "./gps-layout"

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

  it("nunca deja huecos para las combinaciones de las dos secciones", () => {
    const sections: SlotKind[][] = [
      ["wide", "one", "one", "one"], // uso, faenas, km, horas
      ["wide", "one", "one"], // sin un ranking
      ["wide", "one"],
      ["wide"],
      ["one"],
      ["wide", "one", "one", "one", "one"],
      ["one", "wide", "wide", "one"], // ralentí, viajes, alertas, excesos
      ["wide", "wide", "one"], // sin ralentí
      ["one", "wide", "wide"], // sin ranking de excesos
      ["wide", "wide"],
      ["one", "wide"],
    ]
    for (const kinds of sections) {
      const result = gaps(kinds)
      expect(result.xl, kinds.join(",")).toBe(0)
      expect(result.wide, kinds.join(",")).toBe(0)
    }
  })

  it("una celda ancha seguida de una simple abre la simple a la fila en xl", () => {
    expect(layoutChartSlots(["wide", "one"])).toEqual(["wide", "fillXl"])
  })

  it("el ralentí solo junto a viajes ancho ocupa la fila en xl", () => {
    expect(layoutChartSlots(["one", "wide"])[0]).toBe("fillXl")
  })
})
