// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MiniSparkline } from "@/components/ui/mini-sparkline"

afterEach(() => cleanup())

const polyline = (container: HTMLElement) => container.querySelector("polyline")!.getAttribute("points")!
const marker = (container: HTMLElement) => container.querySelector<SVGLineElement>("line[data-marked]")

describe("MiniSparkline", () => {
  it("sin punto marcado dibuja sólo la línea, decorativa", () => {
    const { container } = render(<MiniSparkline data={[1, 3, 2]} />)
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true")
    expect(marker(container)).toBeNull()
    // Tres puntos repartidos de punta a punta: el mayor arriba, el menor abajo.
    expect(polyline(container)).toBe("0.00,26.00 40.00,2.00 80.00,14.00")
  })

  it("sin datos suficientes no dibuja nada", () => {
    expect(render(<MiniSparkline data={[5]} />).container.querySelector("svg")).toBeNull()
  })

  it("marca la lectura pedida sobre la misma posición de la línea", () => {
    const { container } = render(<MiniSparkline data={[100, 110, 90]} markedIndex={2} markedColor="var(--color-danger)" />)
    const dot = marker(container)!
    // El punto va donde termina la línea: la última lectura, la más baja.
    expect(polyline(container).split(" ").at(-1)).toBe("80.00,26.00")
    expect(Number(dot.getAttribute("x1"))).toBe(80)
    expect(Number(dot.getAttribute("y1"))).toBe(26)
    expect(dot.getAttribute("stroke")).toBe("var(--color-danger)")
    // Punta redonda y grosor que no se escala: sigue siendo un círculo aunque el svg se estire.
    expect(dot.getAttribute("stroke-linecap")).toBe("round")
    expect(dot.getAttribute("vector-effect")).toBe("non-scaling-stroke")
  })

  it("un índice fuera de rango no marca nada", () => {
    expect(marker(render(<MiniSparkline data={[1, 2, 3]} markedIndex={7} />).container)).toBeNull()
  })
})
