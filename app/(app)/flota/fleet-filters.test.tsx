// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FleetFilters } from "./fleet-filters"

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/flota",
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const props = { operationalStatuses: ["operativo", "mantencion"], responsibleUsers: [{ id: "Ana", name: "Ana" }], warningDays: 30 }

beforeEach(() => { vi.useFakeTimers(); nav.search = ""; nav.replace.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe("FleetFilters", () => {
  it("el buscador escribe en la URL con router.replace y sin saltar el scroll, tras un retardo", () => {
    render(<FleetFilters {...props} current={{}} />)

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar" }), { target: { value: "DZTH" } })
    expect(nav.replace).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(450) })
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith("/flota?q=DZTH", { scroll: false })
  })

  it("no es un formulario GET: no hay recarga completa al buscar", () => {
    const { container } = render(<FleetFilters {...props} current={{ q: "abc" }} />)
    expect(container.querySelector("form")).toBeNull()
  })

  it("el selector de estado muestra el valor de la URL (controlado), no el de la primera carga", () => {
    const { rerender } = render(<FleetFilters {...props} current={{ estado: "mantencion" }} />)
    expect(screen.getByRole("combobox", { name: "Estado operacional" }).textContent).toContain("En mantención")

    // Al quitar el filtro la URL cambia y el selector vuelve a «todos»: antes seguía mostrando el valor viejo.
    rerender(<FleetFilters {...props} current={{}} />)
    expect(screen.getByRole("combobox", { name: "Estado operacional" }).textContent).toContain("Todos los estados")
  })

  it("quitar el chip de la búsqueda borra el texto del campo", () => {
    nav.search = "q=abc"
    const { rerender } = render(<FleetFilters {...props} current={{ q: "abc" }} />)
    expect((screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement).value).toBe("abc")

    rerender(<FleetFilters {...props} current={{}} />)
    expect((screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement).value).toBe("")
  })

  it("«Limpiar filtros» vuelve a la lista sin parámetros, sin saltar el scroll", () => {
    nav.search = "estado=mantencion"
    render(<FleetFilters {...props} current={{ estado: "mantencion" }} />)

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/flota", { scroll: false })
  })
})
