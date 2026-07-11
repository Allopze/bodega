// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CatalogLinks } from "./catalog-links"

afterEach(cleanup)

describe("CatalogLinks", () => {
  it("only shows links the session actually has permission to open", () => {
    render(<CatalogLinks permissions={["combustibles:manage_vehicles", "combustibles:manage_suppliers"]} />)

    expect(screen.getByText("Vehículos")).toBeInTheDocument()
    expect(screen.getByText("Proveedores de combustible")).toBeInTheDocument()
    expect(screen.queryByText("Viajes y consumo")).not.toBeInTheDocument()
    expect(screen.queryByText("Mantenciones")).not.toBeInTheDocument()
  })

  it("uses canonical administrative destinations", () => {
    render(<CatalogLinks permissions={["combustibles:manage_vehicles", "combustibles:manage_suppliers"]} />)

    expect(screen.getByRole("link", { name: /Vehículos/ })).toHaveAttribute("href", "/admin/flota-catalogos/vehiculos")
    expect(screen.getByRole("link", { name: /Proveedores de combustible/ })).toHaveAttribute("href", "/admin/flota-catalogos/proveedores-combustible")
  })

  it("shows the maintenance link under the real mantenciones:view permission", () => {
    render(<CatalogLinks permissions={["mantenciones:view"]} />)

    expect(screen.getByText("Mantenciones")).toBeInTheDocument()
  })

  it("shows nothing when the session has none of the linked permissions", () => {
    render(<CatalogLinks permissions={[]} />)

    expect(screen.queryByText("Vehículos")).not.toBeInTheDocument()
    expect(screen.queryByText("Mantenciones")).not.toBeInTheDocument()
  })
})
