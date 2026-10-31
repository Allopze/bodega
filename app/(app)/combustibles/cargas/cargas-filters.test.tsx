// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/combustibles/cargas" }))

import { CargasFilters, type CargasFilterLookups } from "./cargas-filters"

afterEach(() => cleanup())

const LOOKUPS: CargasFilterLookups = {
  worksites: [], suppliers: [], products: [], equipmentTypes: [], loadingPoints: [], anomalyRules: [], anomalyAssignees: [], equipmentLabel: null,
}

describe("CargasFilters: lo que dice el cuadro de búsqueda", () => {
  it("sin datos personales ofrece buscar equipo, patente o proveedor, y no menciona personas", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal={false} />)
    const search = screen.getByRole("searchbox", { name: "Buscar equipo, patente o proveedor" })
    expect(search).toHaveAttribute("placeholder", "Buscar equipo, patente o proveedor…")
    expect(search.getAttribute("aria-label")).not.toMatch(/persona/i)
    expect(search.getAttribute("placeholder")).not.toMatch(/persona/i)
  })

  it("con datos personales ofrece, además, buscar personas", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    const search = screen.getByRole("searchbox", { name: "Buscar equipo, patente, proveedor o persona" })
    expect(search).toHaveAttribute("placeholder", "Buscar equipo, patente, proveedor o persona…")
  })

  it("ya no dice «patente o equipo» a secas, que callaba lo que la consulta sí busca", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.queryByRole("searchbox", { name: "Buscar patente o equipo" })).toBeNull()
    expect(screen.queryByPlaceholderText("Buscar patente o equipo…")).toBeNull()
  })

  it("hay un solo cuadro de búsqueda", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.getAllByRole("searchbox")).toHaveLength(1)
  })
})
