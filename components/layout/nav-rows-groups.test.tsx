// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * El cajón móvil pliega los grupos que no tienen la pantalla actual (crítica 2026-11-15, paso 7):
 * Control operacional mostraba sus 19 destinos de una vez. En escritorio el menú no cambia.
 */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import type { AreaNode } from "./nav-items"
import { AreaItems } from "./nav-rows"

const AREA: AreaNode = {
  id: "control-operacional", label: "Control operacional", iconName: "Car", order: 15,
  items: [
    { label: "Panel operacional", href: "/control-operacional", iconName: "ChartLine", group: "Seguimiento" },
    { label: "Vehículos", href: "/flota", iconName: "Truck", group: "Flota" },
    { label: "Conductores", href: "/flota/conductores", iconName: "IdentificationCard", group: "Flota" },
    { label: "Órdenes de trabajo", href: "/mantencion/ot", iconName: "Wrench", group: "Mantención" },
    { label: "Por revisar", href: "/combustibles/revisar", iconName: "Tray", group: "Combustible", badge: "count" },
  ],
}

const toggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) })

afterEach(cleanup)

describe("grupos del menú en el cajón móvil", () => {
  it("abre el grupo de la pantalla actual y pliega los demás, con los pendientes a la vista", () => {
    render(<AreaItems area={AREA} pathname="/mantencion/ot" badgeCounts={{ "/combustibles/revisar": 88 }} collapseInactiveGroups />)
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("true")
    for (const group of ["Seguimiento", "Flota", "Combustible"]) expect(toggle(group).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("link", { name: /Órdenes de trabajo/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByRole("link", { name: /Vehículos/ })).toBeNull()
    // «Por revisar» quedó plegado: su rótulo lleva la cuenta para que no se esconda.
    expect(within(toggle("Combustible")).getByText("88")).toBeTruthy()
  })

  it("un grupo plegado se abre al tocarlo", () => {
    render(<AreaItems area={AREA} pathname="/mantencion/ot" collapseInactiveGroups />)
    fireEvent.click(toggle("Flota"))
    expect(toggle("Flota").getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("link", { name: /Conductores/ })).toBeTruthy()
  })

  it("sin pantalla actual en el área, todos los grupos quedan abiertos", () => {
    render(<AreaItems area={AREA} pathname="/bodega" collapseInactiveGroups />)
    for (const group of ["Seguimiento", "Flota", "Mantención", "Combustible"]) expect(toggle(group).getAttribute("aria-expanded")).toBe("true")
  })

  it("en escritorio los grupos siguen siendo rótulos con todos sus destinos", () => {
    render(<AreaItems area={AREA} pathname="/mantencion/ot" />)
    expect(screen.queryByRole("button", { name: /^Flota/ })).toBeNull()
    expect(screen.getByRole("link", { name: /Vehículos/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Por revisar/ })).toBeTruthy()
  })
})
