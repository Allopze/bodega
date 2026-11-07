// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ pathname: "/dashboard" as string | null }))

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }))
// `next/link` no expone `replace`/`scroll` en el DOM: el doble los deja visibles.
vi.mock("next/link", () => ({
  default: ({ href, replace, scroll, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean; scroll?: boolean; children?: ReactNode }) => (
    <a href={href} data-replace={String(Boolean(replace))} data-scroll={String(scroll !== false)} {...rest}>{children}</a>
  ),
}))

import { SegmentedControl, staysOnPage } from "./segmented-control"

describe("SegmentedControl · navegación entre vistas", () => {
  const items = [
    { key: "mes", label: "Mes", active: true, href: "/dashboard?periodo=mes" },
    { key: "trimestre", label: "Trimestre", active: false, href: "/dashboard?periodo=trimestre" },
  ]

  it("un ítem que sólo cambia la query de esta página es estado de la vista: replace y sin mover el scroll", () => {
    nav.pathname = "/dashboard"
    render(<SegmentedControl ariaLabel="Período del tablero" items={items} />)
    for (const name of ["Mes", "Trimestre"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("data-replace", "true")
      expect(screen.getByRole("link", { name })).toHaveAttribute("data-scroll", "false")
    }
  })

  it("un ítem que va a otra página es navegación: push y el scroll por defecto", () => {
    nav.pathname = "/combustibles/consumo/rendimiento/camiones"
    render(<SegmentedControl ariaLabel="Familia" items={[
      { key: "camiones", label: "Camiones", active: true, href: "/combustibles/consumo/rendimiento/camiones" },
      { key: "buses", label: "Buses", active: false, href: "/combustibles/consumo/rendimiento/buses" },
    ]} />)
    expect(screen.getByRole("link", { name: "Buses" })).toHaveAttribute("data-replace", "false")
    expect(screen.getByRole("link", { name: "Buses" })).toHaveAttribute("data-scroll", "true")
    // El de la propia página sí es un cambio de vista.
    expect(screen.getByRole("link", { name: "Camiones" })).toHaveAttribute("data-replace", "true")
  })

  it("sin pathname conocido no se supone nada", () => {
    nav.pathname = null
    render(<SegmentedControl ariaLabel="Período del tablero" items={items} />)
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("data-replace", "false")
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("data-scroll", "true")
  })

  it("staysOnPage compara ruta y origen, no la query", () => {
    expect(staysOnPage("/dashboard?periodo=anio", "/dashboard")).toBe(true)
    expect(staysOnPage("?periodo=anio", "/dashboard")).toBe(true)
    expect(staysOnPage("/dashboard#alertas", "/dashboard")).toBe(true)
    expect(staysOnPage("/flota?x=1", "/dashboard")).toBe(false)
    expect(staysOnPage("/dashboard/otra", "/dashboard")).toBe(false)
    expect(staysOnPage("https://ejemplo.cl/dashboard", "/dashboard")).toBe(false)
    expect(staysOnPage("/dashboard", null)).toBe(false)
  })
})

describe("SegmentedControl", () => {
  it("agrupa botones de filtro sin falsear un landmark nav", () => {
    render(<SegmentedControl ariaLabel="Faenas" items={[{ key: "all", label: "Todas", active: true, onClick: vi.fn() }]} />)
    expect(screen.getByRole("group", { name: "Faenas" }).tagName).toBe("DIV")
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true")
  })
  it("con enlaces también es un grupo, sin crear un landmark de navegación, y marca la página actual", () => {
    render(<SegmentedControl ariaLabel="Vistas" items={[{ key: "all", label: "Todas", active: true, href: "/all" }]} />)
    expect(screen.getByRole("group", { name: "Vistas" }).tagName).toBe("DIV")
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.getByRole("link", { name: "Todas" })).toHaveAttribute("aria-current", "page")
  })
})
