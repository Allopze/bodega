// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// La URL que lee el componente y los escritores que la cambian: las pruebas miran qué se pidió escribir.
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), setFilter: vi.fn(), setFilters: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/mantencion/registros",
  useSearchParams: () => nav.params,
}))

vi.mock("@/lib/hooks/use-url-filters", () => ({
  useUrlFilters: () => ({
    searchParams: nav.params,
    getFilter: (key: string, defaultValue = "") => nav.params.get(key) ?? defaultValue,
    setFilter: nav.setFilter,
    setFilters: nav.setFilters,
    clearFilters: vi.fn(),
    debounceMs: 350,
    isPending: false,
  }),
}))

import { RecordsFilters } from "./records-filters"

const OPTIONS = {
  worksites: [{ id: "ws-1", name: "Faena de prueba" }, { id: "ws-2", name: "Otra faena de prueba" }],
  executors: [{ value: "u:user-1", label: "Mecánico de prueba" }],
  registrars: [{ value: "user-2", label: "Jefatura de prueba" }],
}

function renderFilters(query: string) {
  nav.params = new URLSearchParams(query)
  return render(<RecordsFilters options={OPTIONS} />)
}

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.setFilter.mockReset()
  nav.setFilters.mockReset()
  nav.replace.mockReset()
})
afterEach(cleanup)

describe("buscador de Registros", () => {
  it("busca por folio, código o patente: ese es su rótulo y su texto de ayuda", () => {
    renderFilters("")
    const search = screen.getByRole("searchbox", { name: "Folio, código o patente" })
    expect(search).toHaveAttribute("placeholder", "Folio, código o patente")
    // El rótulo viejo, que sólo hablaba del equipo, ya no existe.
    expect(screen.queryByRole("searchbox", { name: /Buscar equipo/ })).toBeNull()
  })

  it("conserva `equipo` como parámetro y muestra lo escrito en la pastilla «Búsqueda»", () => {
    renderFilters("equipo=MP-STF-0147")
    expect(screen.getByRole("searchbox", { name: "Folio, código o patente" })).toHaveValue("MP-STF-0147")
    const chip = screen.getByRole("button", { name: "Eliminar filtro Búsqueda" }).parentElement as HTMLElement
    expect(chip.textContent).toBe("Búsqueda:MP-STF-0147")
    expect(screen.queryByRole("button", { name: "Eliminar filtro Equipo" })).toBeNull()
  })

  it("quitar la pastilla borra sólo el parámetro `equipo`", () => {
    renderFilters("equipo=ka91&tipo=C")
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Búsqueda" }))
    expect(nav.setFilter).toHaveBeenCalledWith("equipo", null)
    expect(nav.setFilters).not.toHaveBeenCalled()
  })
})
