// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Estado compartido con los mocks (se levanta antes de los imports): la URL que lee el componente y los
// escritores que la cambian. Las pruebas miran qué se pidió escribir, no una navegación real.
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), setFilter: vi.fn(), setFilters: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/mantencion/registros/historicos",
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

import { HistoryFilters, type HistoryFiltersState } from "./history-filters"

const WORKSITES = [
  { id: "ws-1", name: "Faena de prueba", isActive: true },
  { id: "ws-2", name: "Faena cerrada de prueba", isActive: false },
]
const DEFAULT_PERIOD: HistoryFiltersState = { period: "12m", from: "2025-12-01", to: "2026-11-25" }

function renderFilters(query: string, state: Partial<HistoryFiltersState> = {}, worksites = WORKSITES) {
  nav.params = new URLSearchParams(query)
  return render(<HistoryFilters worksites={worksites} state={{ ...DEFAULT_PERIOD, ...state }} />)
}

/** La pastilla de un filtro activo, por el nombre de su botón «Eliminar filtro …». */
function chip(label: string): HTMLElement {
  return screen.getByRole("button", { name: `Eliminar filtro ${label}` }).parentElement as HTMLElement
}

/** El panel «Más filtros»: el `details` que contiene su resumen. */
function moreFilters(): HTMLDetailsElement {
  return screen.getByText(/^Más filtros/).closest("details") as HTMLDetailsElement
}

/** Abre un selector de la barra y devuelve el texto de sus opciones. */
function optionsOf(name: string): string[] {
  fireEvent.click(screen.getByRole("combobox", { name }))
  return screen.getAllByRole("option").map((option) => option.textContent ?? "")
}

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.setFilter.mockReset()
  nav.setFilters.mockReset()
  nav.replace.mockReset()
})
afterEach(cleanup)

describe("chips de filtros activos", () => {
  it("muestran cada filtro activo con su nombre legible, no con su id", () => {
    renderFilters("q=bomba&faena=ws-1&equipo=veh-1&origen=ot&taller=externo&especialidad=mecanica", {
      period: "todo",
      worksiteName: "Faena de prueba",
      vehicleLabel: "EQ-01 · ABCD12",
    })
    expect(chip("Búsqueda").textContent).toBe("Búsqueda:bomba")
    expect(chip("Faena").textContent).toBe("Faena:Faena de prueba")
    expect(chip("Equipo").textContent).toBe("Equipo:EQ-01 · ABCD12")
    expect(chip("Origen").textContent).toBe("Origen:Orden de trabajo")
    expect(chip("Responsable").textContent).toBe("Responsable:Externo")
    expect(chip("Especialidad").textContent).toBe("Especialidad:Mecánica")
    expect(chip("Período").textContent).toBe("Período:Todo el historial")
  })

  it("sin nombre de faena ni de equipo, el chip dice «La elegida» y «El elegido» en vez de mostrar un id", () => {
    renderFilters("faena=ws-1&equipo=veh-1")
    expect(chip("Faena").textContent).toBe("Faena:La elegida")
    expect(chip("Equipo").textContent).toBe("Equipo:El elegido")
  })

  it("con el período por defecto (últimos 12 meses) no hay chip de período", () => {
    renderFilters("")
    expect(screen.queryByRole("button", { name: /^Eliminar filtro Período$/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Eliminar filtro (Desde|Hasta)/ })).toBeNull()
  })

  it("en rango personalizado, desde y hasta son chips con la fecha en formato chileno", () => {
    renderFilters("periodo=personalizado&desde=2026-01-05&hasta=2026-03-31", { period: "personalizado", from: "2026-01-05", to: "2026-03-31" })
    expect(chip("Desde").textContent).toBe("Desde:05-01-2026")
    expect(chip("Hasta").textContent).toBe("Hasta:31-03-2026")
    expect(screen.queryByRole("button", { name: /Eliminar filtro Período/ })).toBeNull()
  })

  it("quitar un chip de fecha borra desde y hasta juntos: un rango a medias no es un período", () => {
    renderFilters("desde=2026-01-05&hasta=2026-03-31", { period: "personalizado", from: "2026-01-05", to: "2026-03-31" })
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Desde" }))
    expect(nav.setFilters).toHaveBeenCalledWith({ desde: null, hasta: null })
    expect(nav.setFilter).not.toHaveBeenCalled()
  })

  it("quitar «Hasta» también borra «Desde»", () => {
    renderFilters("desde=2026-01-05&hasta=2026-03-31", { period: "personalizado", from: "2026-01-05", to: "2026-03-31" })
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Hasta" }))
    expect(nav.setFilters).toHaveBeenCalledWith({ desde: null, hasta: null })
  })

  it("quitar otro chip sólo borra ese filtro de la URL", () => {
    renderFilters("q=bomba&origen=ot")
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Búsqueda" }))
    expect(nav.setFilter).toHaveBeenCalledWith("q", null)
    expect(nav.setFilters).not.toHaveBeenCalled()
  })

  it("«Limpiar filtros» borra todo, también el tipo, que esta barra no muestra", () => {
    renderFilters("q=bomba&tipo=correctiva")
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(nav.setFilters).toHaveBeenCalledWith({
      q: null, faena: null, equipo: null, origen: null, tipo: null, taller: null, especialidad: null, periodo: null, desde: null, hasta: null,
    })
  })
})

describe("«Más filtros»", () => {
  it("sin taller ni especialidad activos, el panel dice «Más filtros» y va cerrado", () => {
    renderFilters("origen=ot")
    expect(screen.getByText("Más filtros", { selector: "summary" })).toBeDefined()
    expect(moreFilters()).not.toHaveAttribute("open")
  })

  it("con taller o especialidad activos, el contador lo dice y el panel se abre solo", () => {
    const { unmount } = renderFilters("taller=externo&especialidad=mecanica")
    expect(screen.getByText("Más filtros (2)", { selector: "summary" })).toBeDefined()
    expect(moreFilters()).toHaveAttribute("open")
    unmount()
    renderFilters("taller=interno")
    expect(screen.getByText("Más filtros (1)", { selector: "summary" })).toBeDefined()
  })

  it("el contador cuenta sólo los filtros que van dentro del panel, no los que están a la vista", () => {
    renderFilters("faena=ws-1&origen=ot&periodo=todo", { period: "todo" })
    expect(screen.getByText("Más filtros", { selector: "summary" })).toBeDefined()
    expect(moreFilters()).not.toHaveAttribute("open")
  })
})

describe("fechas Desde y Hasta", () => {
  it("sólo aparecen con período personalizado", () => {
    const { unmount } = renderFilters("")
    expect(screen.queryByRole("button", { name: /^Trabajos desde/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Trabajos hasta/ })).toBeNull()
    unmount()
    renderFilters("periodo=personalizado&desde=2026-01-05&hasta=2026-03-31", { period: "personalizado", from: "2026-01-05", to: "2026-03-31" })
    expect(screen.getByRole("button", { name: /^Trabajos desde/ })).toBeDefined()
    expect(screen.getByRole("button", { name: /^Trabajos hasta/ })).toBeDefined()
  })
})

describe("período", () => {
  it("elegir «Todo el historial» pide período todo y quita las fechas", () => {
    renderFilters("")
    optionsOf("Período del historial")
    fireEvent.click(screen.getByRole("option", { name: "Todo el historial" }))
    expect(nav.setFilters).toHaveBeenCalledWith({ periodo: "todo", desde: null, hasta: null })
  })

  it("volver a «Últimos 12 meses» quita el período de la URL, que vuelve al de por defecto", () => {
    renderFilters("periodo=todo", { period: "todo" })
    optionsOf("Período del historial")
    fireEvent.click(screen.getByRole("option", { name: "Últimos 12 meses" }))
    expect(nav.setFilters).toHaveBeenCalledWith({ periodo: null, desde: null, hasta: null })
  })

  it("elegir «Rango de fechas» conserva el rango que ya se ve", () => {
    renderFilters("")
    optionsOf("Período del historial")
    fireEvent.click(screen.getByRole("option", { name: "Rango de fechas" }))
    expect(nav.setFilters).toHaveBeenCalledWith({ periodo: null, desde: "2025-12-01", hasta: "2026-11-25" })
  })
})

describe("faenas", () => {
  it("una faena cerrada lleva «(cerrada)» en la lista; una activa no", () => {
    renderFilters("")
    expect(optionsOf("Filtrar por faena")).toEqual(["Todas las faenas", "Faena de prueba", "Faena cerrada de prueba (cerrada)"])
  })

  it("elegir una faena escribe sólo ese filtro en la URL", () => {
    renderFilters("")
    optionsOf("Filtrar por faena")
    fireEvent.click(screen.getByRole("option", { name: "Faena de prueba" }))
    expect(nav.setFilter).toHaveBeenCalledWith("faena", "ws-1")
    expect(nav.setFilters).not.toHaveBeenCalled()
  })

})

describe("buscador", () => {
  it("muestra el texto que la URL ya trae en `q`, para que la búsqueda se vea al volver a la página", () => {
    renderFilters("q=bomba")
    expect(screen.getByRole("searchbox", { name: "Buscar en el historial de mantenciones" })).toHaveValue("bomba")
  })
})
