// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Delta, deltaTone, type DeltaPolarity, type DeltaTone } from "./delta"

// Matriz polaridad × signo: lo que decide si una alza se pinta de éxito o de alarma.
const MATRIX: Array<[DeltaPolarity, number, DeltaTone]> = [
  ["up-good", 5, "positive"],
  ["up-good", -5, "negative"],
  ["up-bad", 5, "negative"],
  ["up-bad", -5, "positive"],
  ["neutral", 5, "neutral"],
  ["neutral", -5, "neutral"],
  ["up-good", 0, "neutral"],
]

describe("deltaTone", () => {
  it.each(MATRIX)("%s con %d es %s", (polarity, value, tone) => {
    expect(deltaTone(value, polarity)).toBe(tone)
  })

  it("0 no es buena ni mala noticia: neutro con cualquier polaridad (I-14)", () => {
    expect(deltaTone(0, "up-good")).toBe("neutral")
    expect(deltaTone(0, "up-bad")).toBe("neutral")
    expect(deltaTone(0, "neutral")).toBe("neutral")
  })
})

describe("Delta", () => {
  it.each(MATRIX)("pinta %s con %d como %s", (polarity, value, tone) => {
    const { container } = render(<Delta value={value} polarity={polarity} />)
    expect(container.querySelector("[data-delta]")).toHaveAttribute("data-delta", tone)
  })

  it("sin período de comparación (null) no dibuja nada", () => {
    const { container } = render(<Delta value={null} comparisonLabel="vs. sep" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("un valor no finito tampoco inventa una variación", () => {
    const { container } = render(<Delta value={Number.NaN} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("el formato percent no deja espacio: «12%»", () => {
    const { container } = render(<Delta value={12} format="percent" />)
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent(/^12%$/)
  })

  it("el formato pp lleva su unidad", () => {
    const { container } = render(<Delta value={-3} format="pp" />)
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("3 pp")
  })

  it("muestra el valor absoluto: el signo lo dice la flecha", () => {
    const { container } = render(<Delta value={-7} />)
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent(/^7$/)
  })

  it("dice la variación a lectores de pantalla con su rótulo de comparación", () => {
    render(<Delta value={-5} comparisonLabel="vs. sep" />)
    expect(screen.getByText("Baja 5 vs. sep")).toHaveClass("sr-only")
  })

  it("sin rótulo, el texto oculto es sólo la variación", () => {
    render(<Delta value={12} format="percent" />)
    expect(screen.getByText("Sube 12%")).toHaveClass("sr-only")
  })

  it("0 se anuncia como «Sin variación»", () => {
    render(<Delta value={0} />)
    expect(screen.getByText("Sin variación")).toHaveClass("sr-only")
  })

  it("el rótulo de comparación visible va atenuado y fuera del árbol de accesibilidad", () => {
    render(<Delta value={3} comparisonLabel="vs. T3" />)
    const visible = screen.getAllByText("vs. T3").find((node) => node.hasAttribute("aria-hidden"))
    expect(visible).toBeDefined()
    expect(visible).toHaveClass("text-[var(--color-text-muted)]")
  })
})
