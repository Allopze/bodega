// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { KpiCard } from "./kpi-card"

const base = { icon: null, label: "Solicitudes", value: "42", detail: "este mes" } as const

describe("KpiCard", () => {
  it("por defecto es el tile de siempre: cifra mono sobre una Card", () => {
    const { container } = render(<KpiCard {...base} />)
    expect(screen.getByText("42")).toHaveClass("font-mono")
    const tile = container.querySelector("[data-kpi-card]")
    expect(tile).toHaveClass("rounded-[var(--radius-2xl)]", "border")
  })

  it("`numerals=\"sans\"` saca la cifra de la mono", () => {
    render(<KpiCard {...base} numerals="sans" />)
    const value = screen.getByText("42")
    expect(value).not.toHaveClass("font-mono")
    expect(value).toHaveClass("font-sans", "tabular-nums")
  })

  it("`surface=\"flat\"` es una celda del panel: conserva el ancla y no lleva radio ni anillo", () => {
    const { container } = render(<KpiCard {...base} surface="flat" tone="signal" />)
    const tile = container.querySelector("[data-kpi-card]") as HTMLElement
    expect(tile).not.toBeNull()
    expect(tile.className).not.toMatch(/rounded/)
    expect(tile.className).not.toMatch(/ring-/)
    // La señal del tono es una franja, no un anillo.
    expect(tile.className).toContain("shadow-[inset_3px_0_0_var(--color-signal)]")
  })

  it("`empty` reemplaza la cifra por el mensaje y la acción", () => {
    render(<KpiCard {...base} href="/solicitudes" empty={{ message: "Aún no hay solicitudes", actionLabel: "Crear la primera" }} />)
    expect(screen.queryByText("42")).toBeNull()
    expect(screen.getByText("Aún no hay solicitudes")).toBeInTheDocument()
    expect(screen.getByText("Crear la primera")).toBeInTheDocument()
    // El detalle se calla: el estado vacío ya dice qué hacer.
    expect(screen.queryByText("este mes")).toBeNull()
  })

  it("`empty` sin acción muestra sólo el mensaje", () => {
    render(<KpiCard {...base} empty={{ message: "Sin dato" }} />)
    expect(screen.getByText("Sin dato")).toBeInTheDocument()
    expect(screen.queryByText("42")).toBeNull()
  })

  it("`trend` dibuja una Delta con su rótulo de comparación", () => {
    const { container } = render(<KpiCard {...base} trend={-8} trendLabel="vs. sep" trendPolarity="up-bad" />)
    const delta = container.querySelector("[data-delta]")
    expect(delta).toHaveAttribute("data-delta", "positive")
    expect(delta).toHaveTextContent("vs. sep")
    expect(screen.getByText("Baja 8% vs. sep")).toBeInTheDocument()
  })

  it("`trendFormat=\"number\"` muestra unidades en vez de porcentaje", () => {
    render(<KpiCard {...base} trend={3} trendFormat="number" />)
    expect(screen.getByText("Sube 3")).toBeInTheDocument()
  })

  it("sin `trend` no hay Delta", () => {
    const { container } = render(<KpiCard {...base} />)
    expect(container.querySelector("[data-delta]")).toBeNull()
  })
})
