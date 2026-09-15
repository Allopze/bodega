// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/cargos",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

import { AccordionAreas } from "./desktop-nav-areas"
import { ADMIN_AREAS } from "./admin-nav"
import { findActiveArea } from "./nav-items"

/**
 * El catálogo de tipos documentales vivía en un área "Prevención" de un solo
 * ítem, que `AreaSection` pintaba plana (sin disclosure). Al mudarlo a
 * "Catálogos" pasó a depender del acordeón, así que el enlace sólo se ve si
 * esa sección viene abierta. Esto es lo que el e2e del sidebar comprobaba.
 */
function renderAdminSidebar(pathname: string) {
  return render(
    <AccordionAreas
      areas={ADMIN_AREAS}
      pathname={pathname}
      routeArea={findActiveArea(ADMIN_AREAS, pathname)}
    />,
  )
}

describe("sidebar de administración", () => {
  afterEach(cleanup)

  it("ya no expone un área 'Prevención'", () => {
    renderAdminSidebar("/admin/cargos")
    expect(screen.queryByRole("button", { name: "Prevención" })).toBeNull()
  })

  it("muestra 'Tipos de documento SST' dentro de Catálogos, que se auto-abre en una ruta suya", () => {
    renderAdminSidebar("/admin/cargos")

    const catalogos = screen.getByRole("button", { name: "Catálogos" })
    expect(catalogos).toHaveAttribute("aria-expanded", "true")

    const link = screen.getByRole("link", { name: "Tipos de documento SST" })
    expect(link).toBeVisible()
    expect(link).toHaveAttribute("href", "/admin/taxonomia-sst")
  })

  it("marca el ítem como activo al estar en su propia ruta", () => {
    renderAdminSidebar("/admin/taxonomia-sst")
    expect(screen.getByRole("link", { name: "Tipos de documento SST" }))
      .toHaveAttribute("aria-current", "page")
  })

  it("mantiene a 'Tipos de documento SST' junto a sus hermanas 'Tipos de …'", () => {
    const catalogos = ADMIN_AREAS.find((a) => a.id === "catalogos")
    const labels = catalogos?.items.map((i) => i.label) ?? []
    expect(labels).toContain("Tipos de activo TI")
    expect(labels).toContain("Tipos de documento SST")
  })
})
