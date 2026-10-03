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
})
