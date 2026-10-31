// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, replace, scroll, children, ...rest }: { href: string; replace?: boolean; scroll?: boolean; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} data-replace={String(replace)} data-scroll={String(scroll)} {...rest}>{children}</a>
  ),
}))

import { FilterSummaryBar } from "./filter-summary-bar"

afterEach(() => cleanup())

describe("FilterSummaryBar", () => {
  it("una cifra con enlace filtra con replace y sin mover el scroll", () => {
    render(<FilterSummaryBar stats={[{ key: "a", label: "Por validar", value: 12, href: "/combustibles/cargas?estado=por-validar" }]} />)
    const link = screen.getByRole("link", { name: /Por validar/ })
    expect(link).toHaveAttribute("href", "/combustibles/cargas?estado=por-validar")
    expect(link).toHaveAttribute("data-replace", "true")
    expect(link).toHaveAttribute("data-scroll", "false")
  })

  it("una cifra sin enlace (en cero) no es un enlace", () => {
    render(<FilterSummaryBar stats={[{ key: "a", label: "Con observación", value: "Ninguna", valueKind: "text" }]} />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("Ninguna")).toBeInTheDocument()
  })
})
