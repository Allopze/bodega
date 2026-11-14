import { describe, expect, it } from "vitest"
import { chooseSpans, fillsRows, type ChartCellKind } from "./chart-layout"

const SERIES: ChartCellKind = "series"
const COMPACT: ChartCellKind = "compact"

/** Toda combinación de gráficos visibles de las dos secciones debe cerrar sus filas a 2 y a 3 columnas. */
function expectClosed(kinds: ChartCellKind[]) {
  const spans = chooseSpans(kinds)
  expect(spans, kinds.join(",")).toHaveLength(kinds.length)
  expect(fillsRows(spans, 2), `xl: ${spans.join(",")}`).toBe(true)
  expect(fillsRows(spans, 3), `2xl: ${spans.join(",")}`).toBe(true)
  return spans
}

describe("chooseSpans", () => {
  it("sin gráficos no hay nada que repartir", () => {
    expect(chooseSpans([])).toEqual([])
  })

  it("Pautas y disponibilidad: las 4 combinaciones de registros / estado / ranking / días cierran sus filas", () => {
    // [registros (serie), estado de pautas, ranking, días (serie)] con cada subconjunto visible.
    for (let mask = 1; mask < 16; mask++) {
      const kinds: ChartCellKind[] = []
      if (mask & 1) kinds.push(SERIES)
      if (mask & 2) kinds.push(COMPACT)
      if (mask & 4) kinds.push(COMPACT)
      if (mask & 8) kinds.push(SERIES)
      // Los subconjuntos con un solo gráfico compacto no tienen con quién compartir fila: el compacto
      // se estira (`fillXl`/`full`). El de una columna que quede solo a 3 columnas es inevitable
      // sólo si es el único gráfico de la sección.
      if (kinds.length === 1 && kinds[0] === COMPACT) {
        expect(chooseSpans(kinds)).toHaveLength(1)
        continue
      }
      expectClosed(kinds)
    }
  })

  it("Órdenes de trabajo: estado de hoy, flujo y mezcla, con y sin el primero", () => {
    expectClosed([COMPACT, SERIES, COMPACT])
    expectClosed([SERIES, COMPACT])
    expectClosed([SERIES])
    expectClosed([COMPACT, SERIES])
  })

  it("prefiere los anchos naturales cuando ya cierran y estira sólo lo que hace falta", () => {
    // Registros, estado, ranking, días: 2 + 1 + 1 + 2 cierra a 2 y a 3 columnas.
    expect(chooseSpans([SERIES, COMPACT, COMPACT, SERIES])).toEqual(["wide", "one", "one", "wide"])
    // Sin el ranking, el estado de pautas no tiene pareja: se estira a la fila y los días ocupan la suya.
    expect(chooseSpans([SERIES, COMPACT, SERIES])).toEqual(["wide", "fillXl", "full"])
    // Sin ranking ni estado, las dos series ocupan fila completa (a 3 columnas no quedan 2/3 sueltos).
    expect(chooseSpans([SERIES, SERIES])).toEqual(["full", "full"])
  })

  it("una serie sola ocupa la fila completa a las dos grillas", () => {
    expect(chooseSpans([SERIES])).toEqual(["full"])
  })

  it("fillsRows detecta la fila partida y la fila a medias", () => {
    expect(fillsRows(["one", "wide"], 2)).toBe(false)
    expect(fillsRows(["wide"], 3)).toBe(false)
    expect(fillsRows(["wide", "one"], 2)).toBe(false)
  })
})
