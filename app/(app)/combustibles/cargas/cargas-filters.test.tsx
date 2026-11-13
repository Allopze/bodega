// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const current = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(current.query), usePathname: () => "/combustibles/cargas" }))

import { CargasFilters, type CargasFilterLookups } from "./cargas-filters"

afterEach(() => { cleanup(); current.query = "" })

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

describe("CargasFilters: el estado en un solo control", () => {
  it("no hay casilla «Sólo con algo pendiente» aparte: va dentro del select de estado", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.queryByRole("checkbox", { name: /Sólo con algo pendiente/ })).toBeNull()
    expect(screen.getAllByRole("combobox", { name: "Filtrar por estado" })).toHaveLength(1)
  })

  it("las URL antiguas con pendiente=si siguen mostrándose, en el select y como chip", () => {
    current.query = "pendiente=si"
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.getByRole("combobox", { name: "Filtrar por estado" })).toHaveTextContent("Con algo pendiente")
  })

  it("«Más filtros» ya no trae las casillas de casos abiertos ni de pedido de revisión", () => {
    current.query = "anomalia=si"
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.getByRole("combobox", { name: "Filtrar por estado" })).toHaveTextContent("Con un caso abierto")
    expect(screen.queryByRole("button", { name: /Más filtros \(1\)/ })).toBeNull()
  })

  it("el filtro de «cómo llegó» dice «todas» cuando no hay ninguna elegida", () => {
    render(<CargasFilters lookups={LOOKUPS} canViewPersonal />)
    expect(screen.getByRole("button", { name: "Filtrar por cómo llegó la carga" })).toHaveTextContent("Cómo llegó: todas")
  })
})
