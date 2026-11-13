// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import type { Session } from "next-auth"
import { describe, expect, it, vi } from "vitest"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { ajustesNavItems, firstAllowedAjustesHref } from "@/lib/combustibles/section-nav"

const pathname = vi.hoisted(() => ({ current: "/combustibles/ajustes/mandantes" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

const { AjustesNav } = await import("./settings-nav")

const sessionWith = (...permissions: string[]) => ({ user: { id: "u", permissions, isGlobal: true, worksiteIds: [] } }) as unknown as Session
const keys = (session: Session) => ajustesNavItems(session).map((item) => item.key)

describe("submenú de Ajustes filtrado por permiso", () => {
  it("manage_control deja mandantes, medios, familias y umbrales", () => {
    expect(keys(sessionWith("combustibles:manage_control"))).toEqual(["mandantes", "medios", "familias", "umbrales"])
  })

  it("cada permiso abre sólo su sección", () => {
    expect(keys(sessionWith("combustibles:manage_anomaly_rules"))).toEqual(["reglas"])
    expect(keys(sessionWith("combustibles:tae_manage_config"))).toEqual(["puntos-de-carga"])
    expect(keys(sessionWith("combustibles:manage_integrations"))).toEqual(["integraciones"])
  })

  it("sin ningún permiso de ajustes no hay secciones ni primera sección a la que ir", () => {
    const none = sessionWith("combustibles:view", "combustibles:import")
    expect(ajustesNavItems(none)).toEqual([])
    expect(firstAllowedAjustesHref(none)).toBeNull()
  })

  it("los catálogos son un enlace externo a Administración y no cuentan como primera sección", () => {
    const catalogs = ajustesNavItems(sessionWith("admin:fleet_catalog"))
    expect(catalogs).toHaveLength(1)
    expect(catalogs[0]).toMatchObject({ key: "catalogos", href: "/admin/flota-catalogos", external: true })
    expect(firstAllowedAjustesHref(sessionWith("admin:fleet_catalog"))).toBeNull()
  })

  it("la primera sección permitida es la del primer permiso que se tiene", () => {
    expect(firstAllowedAjustesHref(sessionWith("combustibles:manage_integrations", "combustibles:manage_anomaly_rules"))).toBe(FUEL_PATHS.ajustesReglas)
    expect(firstAllowedAjustesHref(sessionWith("combustibles:manage_control"))).toBe(FUEL_PATHS.ajustesMandantes)
  })
})

describe("AjustesNav", () => {
  const session = sessionWith("combustibles:manage_control", "combustibles:manage_anomaly_rules", "admin:fleet_catalog")

  it("marca la sección actual y lleva cada enlace a su ruta", () => {
    pathname.current = "/combustibles/ajustes/umbrales"
    render(<AjustesNav items={ajustesNavItems(session)} />)
    const nav = screen.getByRole("navigation", { name: "Secciones de ajustes" })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Umbrales de revisión/ })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: /Mandantes y tolerancias/ })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("link", { name: /Reglas de detección/ })).toHaveAttribute("href", FUEL_PATHS.ajustesReglas)
  })

  it("una subruta mantiene activa su sección", () => {
    pathname.current = "/combustibles/ajustes/reglas/nueva"
    render(<AjustesNav items={ajustesNavItems(session)} />)
    expect(screen.getByRole("link", { name: /Reglas de detección/ })).toHaveAttribute("aria-current", "page")
  })

  it("«Proveedores y vehículos» lleva a Administración y nunca se marca como actual", () => {
    pathname.current = "/admin/flota-catalogos"
    render(<AjustesNav items={ajustesNavItems(session)} />)
    const link = screen.getByRole("link", { name: /Proveedores y vehículos/ })
    expect(link).toHaveAttribute("href", "/admin/flota-catalogos")
    expect(link).not.toHaveAttribute("aria-current")
    expect(screen.getByText("En Catálogos de flota")).toBeInTheDocument()
  })

  it("sin secciones no pinta la barra", () => {
    const { container } = render(<AjustesNav items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
