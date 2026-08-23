// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CatalogLinks } from "./catalog-links"

afterEach(cleanup)

describe("CatalogLinks", () => {
  it("only shows links the session actually has permission to open", () => {
    render(<CatalogLinks permissions={["admin:fleet_vehicles", "combustibles:manage_suppliers"]} />)

    expect(screen.getByText("Vehículos")).toBeInTheDocument()
    expect(screen.getByText("Proveedores de combustible")).toBeInTheDocument()
    expect(screen.queryByText("Viajes y consumo")).not.toBeInTheDocument()
    expect(screen.queryByText("Mantenciones")).not.toBeInTheDocument()
  })

  it("uses canonical administrative destinations", () => {
    render(<CatalogLinks permissions={["admin:fleet_vehicles", "combustibles:manage_suppliers"]} />)

    expect(screen.getByRole("link", { name: /Vehículos/ })).toHaveAttribute("href", "/admin/flota-catalogos/vehiculos")
    expect(screen.getByRole("link", { name: /Proveedores de combustible/ })).toHaveAttribute("href", "/admin/flota-catalogos/proveedores-combustible")
  })

  /**
   * El padrón dejó de colgar de `combustibles:manage_vehicles` (2026-08-23): ese
   * permiso quedó para la decisión operativa —sacar un equipo de servicio,
   * vincular patentes de un lote—, y mantener el dato maestro es
   * `admin:fleet_vehicles`. Se prueba el sentido negativo porque es el que
   * detecta una regresión silenciosa si alguien reunifica los dos.
   */
  it("el permiso operativo de flota ya no abre el padrón de vehículos", () => {
    render(<CatalogLinks permissions={["combustibles:manage_vehicles"]} />)

    expect(screen.queryByText("Vehículos")).not.toBeInTheDocument()
  })

  it("shows the maintenance link under the real mantenciones:view permission", () => {
    render(<CatalogLinks permissions={["mantenciones:view"]} />)

    expect(screen.getByText("Mantenciones")).toBeInTheDocument()
  })

  it("exposes the configurable equipment taxonomy to fleet administrators", () => {
    render(<CatalogLinks permissions={["admin:fleet_catalog"]} />)

    expect(screen.getByRole("link", { name: /Tipos de equipo/ })).toHaveAttribute("href", "/admin/flota-catalogos/tipos-equipo")
    expect(screen.getByRole("link", { name: /Productos de combustible/ })).toHaveAttribute("href", "/admin/flota-catalogos/productos-combustible")
  })

  it("shows nothing when the session has none of the linked permissions", () => {
    render(<CatalogLinks permissions={[]} />)

    expect(screen.queryByText("Vehículos")).not.toBeInTheDocument()
    expect(screen.queryByText("Mantenciones")).not.toBeInTheDocument()
  })
})
