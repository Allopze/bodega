// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RadialTickGauge } from "./radial-tick-gauge"

function ticks(container: HTMLElement) {
  return Array.from(container.querySelectorAll<SVGLineElement>("line[data-tick]"))
}

describe("RadialTickGauge", () => {
  it("dibuja 41 marcas radiales", () => {
    const { container } = render(<RadialTickGauge percent={0} expectedPercent={58} targetPercent={90} />)
    expect(ticks(container)).toHaveLength(41)
  })

  it("el aria-label resume avance, esperado y meta", () => {
    render(<RadialTickGauge percent={0} expectedPercent={58} targetPercent={90} />)
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Avance 0 %; esperado 58 %; meta 90 %")
  })

  it("muestra la cifra y el rótulo por defecto «avance real»", () => {
    render(<RadialTickGauge percent={34} expectedPercent={58} targetPercent={90} />)
    expect(screen.getByText("34 %")).toBeInTheDocument()
    expect(screen.getByText("avance real")).toBeInTheDocument()
  })

  it("acepta otro rótulo", () => {
    render(<RadialTickGauge percent={34} targetPercent={90} caption="cumplimiento" />)
    expect(screen.getByText("cumplimiento")).toBeInTheDocument()
  })

  it("la leyenda dice esperado y meta", () => {
    const { container } = render(<RadialTickGauge percent={0} expectedPercent={58} targetPercent={90} />)
    expect(container.querySelector("p")).toHaveTextContent("Esperado al período 58 % · Meta 90 %")
  })

  it("sin esperado la leyenda sólo lleva la meta y el aria-label lo calla", () => {
    const { container } = render(<RadialTickGauge percent={20} expectedPercent={null} targetPercent={90} />)
    expect(container.querySelector("p")).toHaveTextContent(/^Meta 90 %$/)
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Avance 20 %; meta 90 %")
    expect(container.querySelector("[data-marker=expected]")).toBeNull()
  })

  it("la cifra se pinta de alerta (`-ink`) cuando va por debajo de lo esperado", () => {
    render(<RadialTickGauge percent={20} expectedPercent={58} targetPercent={90} />)
    expect(screen.getByText("20 %")).toHaveAttribute("fill", "var(--color-danger-ink)")
  })

  it("y de texto normal cuando alcanza lo esperado", () => {
    render(<RadialTickGauge percent={60} expectedPercent={58} targetPercent={90} />)
    expect(screen.getByText("60 %")).toHaveAttribute("fill", "var(--color-text)")
  })

  it("con avance 0 ninguna marca se rellena de primario", () => {
    const { container } = render(<RadialTickGauge percent={0} expectedPercent={58} targetPercent={90} />)
    expect(ticks(container).some((tick) => tick.getAttribute("stroke") === "var(--color-primary)")).toBe(false)
  })

  it("rellena de primario las marcas hasta el avance, y sólo ésas", () => {
    const { container } = render(<RadialTickGauge percent={50} expectedPercent={80} targetPercent={95} />)
    const filled = ticks(container).filter((tick) => tick.getAttribute("stroke") === "var(--color-primary)")
    // 0, 2,5, … 50: 21 marcas de 41.
    expect(filled).toHaveLength(21)
  })

  it("las marcas de esperado y meta son más largas y de color propio", () => {
    const { container } = render(<RadialTickGauge percent={0} expectedPercent={60} targetPercent={90} />)
    const all = ticks(container)
    const expected = container.querySelector<SVGLineElement>("[data-marker=expected]")!
    const target = container.querySelector<SVGLineElement>("[data-marker=target]")!
    const length = (line: SVGLineElement) => Math.hypot(
      Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
      Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")),
    )
    const plain = all.find((tick) => !tick.hasAttribute("data-marker"))!
    expect(expected.getAttribute("stroke")).toBe("var(--color-text)")
    expect(target.getAttribute("stroke")).toBe("var(--color-text-subtle)")
    expect(plain.getAttribute("stroke")).toBe("var(--color-border-strong)")
    expect(length(expected)).toBeGreaterThan(length(plain))
    expect(length(target)).toBeGreaterThan(length(plain))
    // 60 % cae en la marca 24 de 41 (0-40).
    expect(all.indexOf(expected)).toBe(24)
    expect(all.indexOf(target)).toBe(36)
  })

  it("las marcas entran en secuencia con `tick-in` bajo `motion-safe`", () => {
    const { container } = render(<RadialTickGauge percent={0} targetPercent={90} />)
    const all = ticks(container)
    expect(all[0]!.getAttribute("class")).toContain("motion-safe:animate-[tick-in_")
    expect(all[0]!.style.animationDelay).toBe("0ms")
    expect(all[10]!.style.animationDelay).toBe("140ms")
  })

  it("usa viewBox, ancho fluido y un tope de 300 px", () => {
    render(<RadialTickGauge percent={0} targetPercent={90} />)
    const svg = screen.getByRole("img")
    expect(svg).toHaveAttribute("viewBox")
    expect(svg).toHaveAttribute("width", "100%")
    expect((svg as unknown as SVGElement).style.maxWidth).toBe("300px")
  })

  describe("sin programa vigente (percent null)", () => {
    it("muestra «—» y «Sin programa vigente» en vez de un 0 inventado", () => {
      const { container } = render(<RadialTickGauge percent={null} expectedPercent={null} targetPercent={90} />)
      expect(screen.getByText("—")).toBeInTheDocument()
      expect(screen.getAllByText("Sin programa vigente").length).toBeGreaterThan(0)
      expect(screen.queryByText("avance real")).toBeNull()
      expect(ticks(container).some((tick) => tick.getAttribute("stroke") === "var(--color-primary)")).toBe(false)
    })

    it("el aria-label dice que no hay programa", () => {
      render(<RadialTickGauge percent={null} targetPercent={90} />)
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Sin programa vigente; meta 90 %")
    })
  })
})
