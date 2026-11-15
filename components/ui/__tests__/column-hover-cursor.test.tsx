// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Bar, BarChart, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts"
import { ColumnHoverCursor } from "../chart-interactions"

afterEach(cleanup)

const DATA = [
  { month: "2026-06", amount: 10, price: 1 },
  { month: "2026-07", amount: 140, price: 2 },
  { month: "2026-08", amount: 20, price: 3 },
  { month: "2026-09", amount: 30, price: 4 },
]

const WIDTH = 400
const HEIGHT = 200

/** El rectángulo de la columna apuntada y la capa (`zIndex`) en que recharts lo dibujó. */
function cursorOf(container: HTMLElement) {
  const cursor = container.querySelector<SVGPathElement>(".recharts-tooltip-cursor")
  expect(cursor, "el gráfico no dibujó la columna apuntada").not.toBeNull()
  const layer = cursor!.closest("[class*='recharts-zIndex-layer_']")
  const zIndex = Number(layer?.getAttribute("class")?.match(/recharts-zIndex-layer_(-?\d+)/)?.[1] ?? 0)
  // `Rectangle` deja su geometría como atributos del `path`.
  return { zIndex, width: Number(cursor!.getAttribute("width")), minX: Number(cursor!.getAttribute("x")) }
}

describe("ColumnHoverCursor", () => {
  it("en un gráfico mixto (columnas + línea) resalta sólo la columna apuntada, bajo las series", () => {
    const { container } = render(
      <ComposedChart width={WIDTH} height={HEIGHT} data={DATA} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="month" />
        <YAxis yAxisId="amount" width={40} />
        <YAxis yAxisId="price" orientation="right" width={40} />
        <Tooltip defaultIndex={1} cursor={<ColumnHoverCursor />} isAnimationActive={false} />
        <Bar yAxisId="amount" dataKey="amount" isAnimationActive={false} />
        <Line yAxisId="price" dataKey="price" isAnimationActive={false} />
      </ComposedChart>,
    )
    const plotWidth = WIDTH - 80
    const cursor = cursorOf(container)
    // Antes cubría el área completa del gráfico (x = 0, ancho = plotWidth) y tapaba columnas y línea.
    expect(cursor.width).toBeCloseTo(plotWidth / DATA.length, 0)
    expect(cursor.minX).toBeCloseTo(40 + plotWidth / DATA.length, 0)
    expect(cursor.zIndex).toBeLessThan(300) // DefaultZIndexes.bar
  })

  it("en un gráfico de barras sigue usando la columna que calcula recharts", () => {
    const { container } = render(
      <BarChart width={WIDTH} height={HEIGHT} data={DATA} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="month" />
        <YAxis width={40} />
        <Tooltip defaultIndex={1} cursor={<ColumnHoverCursor />} isAnimationActive={false} />
        <Bar dataKey="amount" isAnimationActive={false} />
      </BarChart>,
    )
    const cursor = cursorOf(container)
    expect(cursor.width).toBeCloseTo((WIDTH - 40) / DATA.length, 0)
    expect(cursor.zIndex).toBeLessThan(300)
  })
})
