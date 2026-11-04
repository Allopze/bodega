// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CoverageNotice } from "@/components/charts/coverage-notice"

/**
 * El aviso de cobertura (Fase 4, CHART-022): una línea sobre el gráfico que dice qué meses
 * no tienen datos del proveedor y qué cifras quedan cortas. Lo que se prueba es lo que lo
 * hace confiable: que diga sólo lo que es cierto, que no aparezca sin motivo y que no
 * ofrezca un enlace roto.
 */
describe("CoverageNotice", () => {
  const subject = "los litros y el costo de los últimos 6 meses"

  it("nombra el mes sin datos, las cifras que no lo incluyen y lleva a «Fuentes de datos»", () => {
    const { container } = render(<CoverageNotice gapMonths={["2026-09"]} subject={subject} sourcesHref="/combustibles/fuentes" />)

    expect(container.textContent).toContain("Sin datos del proveedor en sep-2026: los litros y el costo de los últimos 6 meses no incluyen ese mes.")
    expect(screen.getByRole("link", { name: "Ver cobertura de las fuentes" }).getAttribute("href")).toBe("/combustibles/fuentes")
  })

  it("dice los meses parciales aparte de los huecos", () => {
    const { container } = render(<CoverageNotice gapMonths={["2026-09"]} partialMonths={["2026-11"]} subject={subject} />)

    expect(container.textContent).toContain("no incluyen ese mes. El mes de nov-2026 todavía no está completo.")
  })

  it("sin meses que advertir no pinta nada: la ausencia de aviso es la buena noticia", () => {
    const { container } = render(<CoverageNotice gapMonths={[]} partialMonths={[]} subject={subject} sourcesHref="/combustibles/fuentes" />)

    expect(container.innerHTML).toBe("")
  })

  it("sin enlace a Fuentes (quien no puede abrirlo) queda el texto, sin un enlace a /forbidden", () => {
    const { container } = render(<CoverageNotice gapMonths={["2026-09"]} subject={subject} />)

    expect(container.textContent).toContain("Sin datos del proveedor en sep-2026")
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("el ícono es decorativo: el estado lo dice el texto, no el color", () => {
    const { container } = render(<CoverageNotice gapMonths={["2026-09"]} subject={subject} />)

    const icon = container.querySelector("svg")!
    expect(icon.getAttribute("aria-hidden")).toBe("true")
    // Texto de estado en tokens -ink (regla 8): nunca el token base de advertencia como color de texto.
    expect(container.innerHTML).not.toMatch(/text-\[var\(--color-warning\)\]/)
  })

  it("acepta otra fuente: la telemetría no se llama «proveedor»", () => {
    const { container } = render(<CoverageNotice gapMonths={["2026-10"]} subject="las horas de motor" source="de la telemetría" />)

    expect(container.textContent).toContain("Sin datos de la telemetría en oct-2026: las horas de motor no incluyen ese mes.")
  })
})
