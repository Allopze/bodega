// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SectionNav } from "./section-nav"
import { SectionNavSkeleton } from "./section-nav-skeleton"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

const ITEMS = [
  { key: "a", href: "/a", label: "Uno" },
  { key: "b", href: "/b", label: "Dos" },
  { key: "c", href: "/c", label: "Tres" },
]

describe("SectionNavSkeleton", () => {
  it("dibuja un hueco por pestaña y es decorativo: sin hito de navegación ni enlaces", () => {
    const { container, queryByRole } = render(<SectionNavSkeleton tabs={6} />)
    const root = container.firstElementChild
    expect(root).toHaveAttribute("aria-hidden", "true")
    expect(root?.querySelectorAll("li")).toHaveLength(6)
    expect(queryByRole("navigation")).toBeNull()
    expect(container.querySelector("a")).toBeNull()
  })

  it("sin `tabs` dibuja cuatro huecos", () => {
    const { container } = render(<SectionNavSkeleton />)
    expect(container.querySelectorAll("li")).toHaveLength(4)
  })

  it("tiene la misma caja que `SectionNav`: si una cambia de altura y la otra no, la página salta al cargar", () => {
    const real = render(<SectionNav items={ITEMS} activeKey="a" ariaLabel="Vistas" />).container
    const fake = render(<SectionNavSkeleton tabs={3} />).container

    const realNav = real.querySelector("nav")
    const fakeRoot = fake.firstElementChild
    expect(realNav).not.toBeNull()
    expect(fakeRoot?.className).toBe(realNav?.className)
    expect(fake.querySelector("ul")?.className).toBe(real.querySelector("ul")?.className)

    // Lo que fija la altura de la pestaña: alto mínimo, borde inferior y el
    // margen negativo que lo solapa con el borde de la barra.
    const realTab = real.querySelector("a")
    const fakeTab = fake.querySelector("li > div")
    for (const token of ["-mb-px", "inline-flex", "min-h-11", "items-center", "border-b-2", "px-3"]) {
      expect(realTab, `SectionNav ya no usa «${token}»: actualiza el esqueleto`).toHaveClass(token)
      expect(fakeTab, `el esqueleto perdió «${token}»`).toHaveClass(token)
    }
  })
})
