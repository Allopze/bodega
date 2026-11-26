// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * El cajón móvil (crítica 2026-11-15, paso 7) y el panel de escritorio (auditoría de encontrabilidad 2026-11-26)
 * pliegan los grupos que no tienen la pantalla actual: Control operacional mostraba sus 19 destinos de una vez y a
 * 1440×900 se veían 2 de los 7 ítems de Mantención. Sin la prop `collapseInactiveGroups`, los grupos son rótulos fijos.
 */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/ot",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

import type { Session } from "next-auth"
import { AccordionAreas } from "./desktop-nav-areas"
import { findActiveArea, getVisibleAreas, type AreaNode } from "./nav-items"
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

  it("sin plegar, los grupos son rótulos fijos con todos sus destinos", () => {
    render(<AreaItems area={AREA} pathname="/mantencion/ot" />)
    expect(screen.queryByRole("button", { name: /^Flota/ })).toBeNull()
    expect(screen.getByRole("link", { name: /Vehículos/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Por revisar/ })).toBeTruthy()
  })

  it("el rótulo de un grupo es un botón nativo con aria-expanded: el teclado lo abre y lo cierra como a cualquier botón", () => {
    render(<AreaItems area={AREA} pathname="/mantencion/ot" collapseInactiveGroups />)
    const flota = toggle("Flota")
    expect(flota.tagName).toBe("BUTTON")
    expect(flota.getAttribute("type")).toBe("button")
    expect(flota.getAttribute("aria-controls")).toBeTruthy()
    // 44 px en el teléfono y 36 en escritorio, donde la altura del menú es lo escaso.
    expect(flota.className).toContain("min-h-11")
    expect(flota.className).toContain("lg:min-h-9")
    fireEvent.click(flota)
    expect(flota.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(flota)
    expect(flota.getAttribute("aria-expanded")).toBe("false")
  })
})

describe("grupos plegados en el panel de escritorio", () => {
  const renderPanel = (pathname: string) =>
    render(<AccordionAreas areas={[AREA]} pathname={pathname} routeArea="control-operacional" badgeCounts={{ "/combustibles/revisar": 12 }} />)

  it("abre el grupo de la pantalla actual y pliega los demás, con los pendientes del plegado a la vista", () => {
    renderPanel("/mantencion/ot")
    expect(screen.getByRole("button", { name: "Control operacional" }).getAttribute("aria-expanded")).toBe("true")
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("true")
    for (const group of ["Seguimiento", "Flota", "Combustible"]) expect(toggle(group).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("link", { name: /Órdenes de trabajo/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByRole("link", { name: /Vehículos/ })).toBeNull()
    expect(within(toggle("Combustible")).getByText("12")).toBeTruthy()
  })

  it("sin ningún grupo activo, todos quedan abiertos, como antes de plegar", () => {
    renderPanel("/bodega")
    for (const group of ["Seguimiento", "Flota", "Mantención", "Combustible"]) expect(toggle(group).getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("link", { name: /Vehículos/ })).toBeTruthy()
  })

  it("al pasar a otro grupo, el que se abrió solo se pliega y el que la persona abrió a mano se queda", () => {
    const view = renderPanel("/mantencion/ot")
    fireEvent.click(toggle("Flota"))
    expect(toggle("Flota").getAttribute("aria-expanded")).toBe("true")

    view.rerender(<AccordionAreas areas={[AREA]} pathname="/combustibles/revisar" routeArea="control-operacional" />)
    expect(toggle("Combustible").getAttribute("aria-expanded")).toBe("true")
    // Mantención se abrió porque la pantalla era suya: al irse, se pliega y el menú no acumula grupos abiertos.
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("false")
    // Flota lo abrió la persona: se queda como lo dejó.
    expect(toggle("Flota").getAttribute("aria-expanded")).toBe("true")
  })

  it("un grupo que la persona cerró a mano se vuelve a abrir cuando la pantalla pasa a ser suya", () => {
    const view = renderPanel("/mantencion/ot")
    fireEvent.click(toggle("Mantención"))
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("false")

    view.rerender(<AccordionAreas areas={[AREA]} pathname="/flota/conductores" routeArea="control-operacional" />)
    view.rerender(<AccordionAreas areas={[AREA]} pathname="/mantencion/ot" routeArea="control-operacional" />)
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("true")
  })
})

describe("«Configuración» desplegada (defaultOpen)", () => {
  const areaConPadre = (defaultOpen: boolean): AreaNode => ({
    id: "control-operacional", label: "Control operacional", iconName: "Car", order: 15,
    items: [
      { label: "Órdenes de trabajo", href: "/mantencion/ot", iconName: "Wrench", group: "Mantención" },
      {
        label: "Configuración", href: "/mantencion/pautas", iconName: "GearSix", group: "Mantención", defaultOpen,
        children: [
          { label: "Pautas", href: "/mantencion/pautas" },
          { label: "App del mecánico", href: "/mantencion/dispositivos" },
        ],
      },
    ],
  })
  const caret = () => screen.getByRole("button", { name: "Mostrar destinos de Configuración" })

  it("con defaultOpen, sus hijos se ven sin abrirlo aunque la pantalla actual sea otra", () => {
    render(<AreaItems area={areaConPadre(true)} pathname="/mantencion/ot" />)
    expect(caret().getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("link", { name: "Pautas" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "App del mecánico" })).toBeTruthy()
  })

  it("sin defaultOpen, el padre sigue plegado hasta que la pantalla es suya", () => {
    render(<AreaItems area={areaConPadre(false)} pathname="/mantencion/ot" />)
    expect(caret().getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("link", { name: "Pautas" })).toBeNull()
  })

  it("el padre conserva su enlace de redirección y la persona puede plegarlo", () => {
    render(<AreaItems area={areaConPadre(true)} pathname="/mantencion/ot" />)
    expect(screen.getAllByRole("link", { name: "Configuración" })[0]!.getAttribute("href")).toBe("/mantencion/pautas")
    fireEvent.click(caret())
    expect(caret().getAttribute("aria-expanded")).toBe("false")
  })

  it("dentro de un grupo plegable, el padre abierto no se pierde al abrir su grupo", () => {
    render(<AreaItems area={areaConPadre(true)} pathname="/mantencion/ot" collapseInactiveGroups />)
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("true")
    expect(caret().getAttribute("aria-expanded")).toBe("true")
  })
})

describe("la ficha del equipo en el menú (alias con comodín)", () => {
  const sessionWith = (permissions: string[]): Session => ({
    expires: "2030-01-01T00:00:00.000Z",
    user: { id: "u-1", name: "Prueba", email: "prueba@test.cl", roles: [], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
  })
  const control = (permissions: string[]) => getVisibleAreas(sessionWith(permissions)).find((area) => area.id === "control-operacional")!
  const FICHA = "/flota/veh-1/mantencion"

  it("marca «Equipos» y deja abierto su grupo, no el de «Vehículos»", () => {
    const area = control(["flota:view", "mant:records:view_worksite"])
    render(<AreaItems area={area} pathname={FICHA} collapseInactiveGroups />)
    expect(screen.getByRole("link", { name: "Equipos" }).getAttribute("aria-current")).toBe("page")
    expect(toggle("Mantención").getAttribute("aria-expanded")).toBe("true")
    expect(toggle("Flota").getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("link", { name: "Vehículos" })).toBeNull()
  })

  it("para quien no ve «Equipos», «Vehículos» sigue marcado y su grupo abierto", () => {
    const area = control(["flota:view"])
    render(<AreaItems area={area} pathname={FICHA} collapseInactiveGroups />)
    expect(screen.getByRole("link", { name: "Vehículos" }).getAttribute("aria-current")).toBe("page")
    expect(toggle("Flota").getAttribute("aria-expanded")).toBe("true")
  })

  it("las otras pestañas de la ficha siguen marcando «Vehículos»", () => {
    render(<AreaItems area={control(["flota:view", "mant:records:view_worksite"])} pathname="/flota/veh-1/combustible" collapseInactiveGroups />)
    expect(screen.getByRole("link", { name: "Vehículos" }).getAttribute("aria-current")).toBe("page")
  })

  it("el área activa de la ficha es Control operacional con o sin «Equipos» en el menú", () => {
    expect(findActiveArea([control(["flota:view"])], FICHA)).toBe("control-operacional")
    expect(findActiveArea([control(["flota:view", "mant:records:view_worksite"])], FICHA)).toBe("control-operacional")
  })
})
