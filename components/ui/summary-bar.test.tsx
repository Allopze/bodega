// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SummaryBar, type SummaryLinkProps } from "./summary-bar"

describe("SummaryBar", () => {
  it("con `renderLink`, cada cifra con `href` navega con el enlace que le pasan", () => {
    const renderLink = vi.fn(({ href, className, children, ...rest }: SummaryLinkProps) => (
      <a href={href} className={className} data-testid="propio" {...rest}>{children}</a>
    ))
    render(<SummaryBar renderLink={renderLink} stats={[
      { key: "a", label: "En revisión", value: 2, href: "/x?estado=en_revision" },
      { key: "b", label: "Sin enlace", value: 0 },
    ]} />)
    const link = screen.getByRole("link", { name: /^En revisión/ })
    expect(link).toHaveAttribute("href", "/x?estado=en_revision")
    expect(link).toHaveAttribute("data-testid", "propio")
    expect(link).toHaveAttribute("data-pressable")
    expect(renderLink).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("link", { name: /^Sin enlace/ })).toBeNull()
    expect(screen.getByText("Sin enlace")).toBeInTheDocument()
  })

  it("sin `renderLink` sigue usando el enlace de Next", () => {
    render(<SummaryBar stats={[{ key: "a", label: "Vencidas", value: 3, href: "/y" }]} />)
    expect(screen.getByRole("link", { name: /^Vencidas/ })).toHaveAttribute("href", "/y")
  })

  it("el rótulo de la cifra parte en hasta dos líneas en vez de recortarse con «…» (390 px, A6: no se abrevia)", () => {
    render(<SummaryBar stats={[{ key: "a", label: "Importantes e Intolerables", value: 42 }]} />)
    const label = screen.getByText("Importantes e Intolerables")
    expect(label).toHaveClass("line-clamp-2")
    expect(label).not.toHaveClass("truncate")
  })

  it("un valor de texto va en la sans del cuerpo: sin mono ni tabular-nums", () => {
    render(<SummaryBar stats={[{ key: "a", label: "Avance del plan", value: "Aún sin actividades", valueKind: "text", tone: "signal" }, { key: "b", label: "Otra", value: 7 }]} />)
    const text = screen.getByText("Aún sin actividades")
    expect(text).toHaveClass("text-base", "font-semibold")
    expect(text).not.toHaveClass("font-mono")
    expect(text).not.toHaveClass("tabular-nums")
    expect(screen.getByText("7")).toHaveClass("font-mono")
  })

  describe("tono", () => {
    it("`signal` enciende con un valor > 0 y deja el 0 atenuado: el comportamiento de siempre", () => {
      render(<SummaryBar stats={[
        { key: "a", label: "Vencidas", value: 3, tone: "signal" },
        { key: "b", label: "Sin pendientes", value: 0, tone: "signal" },
      ]} />)
      expect(screen.getByText("3")).toHaveClass("text-[var(--color-signal-ink)]")
      const zero = screen.getByText("0")
      expect(zero).toHaveClass("text-[var(--color-text-faint)]")
      expect(zero).not.toHaveClass("text-[var(--color-signal-ink)]")
    })

    it("`danger` pinta con el token -ink, nunca con el color base ni con el naranja", () => {
      render(<SummaryBar stats={[{ key: "a", label: "Críticas", value: 2, tone: "danger", hint: "Bajo 80%" }]} />)
      const value = screen.getByText("2")
      expect(value).toHaveClass("text-[var(--color-danger-ink)]")
      expect(value).not.toHaveClass("text-[var(--color-signal-ink)]")
      expect(value.className).not.toMatch(/text-\[var\(--color-(danger|signal|warning)\)\]/)
      expect(screen.getByText("Bajo 80%")).toHaveClass("text-[var(--color-danger-ink)]")
    })

    it("`danger` sin `toneWhenZero` tampoco tiñe un 0", () => {
      render(<SummaryBar stats={[{ key: "a", label: "Críticas", value: 0, tone: "danger" }]} />)
      expect(screen.getByText("0")).not.toHaveClass("text-[var(--color-danger-ink)]")
    })

    it("con `toneWhenZero` el tono aplica aunque el valor sea 0, también si viene como texto con porcentaje", () => {
      render(<SummaryBar stats={[
        { key: "a", label: "Cumplimiento", value: "0%", tone: "danger", toneWhenZero: true },
        { key: "b", label: "Disponibilidad", value: "0,5%", tone: "signal", toneWhenZero: true },
        { key: "c", label: "Numérica", value: 0, tone: "danger", toneWhenZero: true },
      ]} />)
      expect(screen.getByText("0%")).toHaveClass("text-[var(--color-danger-ink)]")
      expect(screen.getByText("0,5%")).toHaveClass("text-[var(--color-signal-ink)]")
      expect(screen.getByText("0")).toHaveClass("text-[var(--color-danger-ink)]")
    })

    it("un valor-frase no se tiñe ni con `toneWhenZero`", () => {
      render(<SummaryBar stats={[{ key: "a", label: "Disponibilidad", value: "Sin datos", valueKind: "text", tone: "danger", toneWhenZero: true }]} />)
      expect(screen.getByText("Sin datos")).not.toHaveClass("text-[var(--color-danger-ink)]")
    })

    it("la variante compacta aplica los mismos tonos", () => {
      render(<SummaryBar compact stats={[
        { key: "a", label: "Disponibilidad", value: "0%", tone: "danger", toneWhenZero: true },
        { key: "b", label: "Vencidas", value: 0, tone: "danger" },
      ]} />)
      expect(screen.getByText("0%")).toHaveClass("text-[var(--color-danger-ink)]")
      expect(screen.getByText("0")).not.toHaveClass("text-[var(--color-danger-ink)]")
    })
  })
})
