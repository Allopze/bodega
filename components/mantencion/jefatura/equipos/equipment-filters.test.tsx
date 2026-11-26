// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// La URL que lee el componente y el `router.replace` que la cambia: se mira qué navegación se pidió, con qué opciones.
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/mantencion/equipos",
  useSearchParams: () => nav.params,
}))

import { EquipmentFilters } from "./equipment-filters"

const OPTIONS = {
  worksites: [{ value: "ws-1", label: "Faena de prueba" }],
  types: [{ value: "t-1", label: "Camión" }],
  schedules: [{ value: "s-1", label: "Camiones y tractos" }],
}

function renderFilters(query = "") {
  nav.params = new URLSearchParams(query)
  return render(<EquipmentFilters options={OPTIONS} canViewGps />)
}

const taller = () => screen.getByRole("checkbox", { name: "En taller" }) as HTMLInputElement
const bajas = () => screen.getByRole("checkbox", { name: "Mostrar dados de baja" }) as HTMLInputElement

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
})
afterEach(cleanup)

describe("«En taller» como filtro de Equipos", () => {
  it("es una casilla junto a «Mostrar dados de baja», apagada si la URL no trae `taller`", () => {
    renderFilters()
    expect(taller().checked).toBe(false)
    expect(taller().parentElement!.parentElement).toBe(bajas().parentElement!.parentElement)
  })

  it("marcarla escribe `taller=1` en la URL con `router.replace` y sin mover el scroll", () => {
    renderFilters()
    fireEvent.click(taller())
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/equipos?taller=1", { scroll: false })
    // Responde al toque, sin esperar a que la URL nueva llegue del servidor.
    expect(taller().checked).toBe(true)
  })

  it("conserva los demás filtros y la casilla de bajas al marcarla", () => {
    renderFilters("faena=ws-1&bajas=1&page=3")
    fireEvent.click(taller())
    const [href, options] = nav.replace.mock.calls[0]!
    const params = new URLSearchParams(String(href).split("?")[1])
    expect(params.get("faena")).toBe("ws-1")
    expect(params.get("bajas")).toBe("1")
    expect(params.get("taller")).toBe("1")
    // Un filtro nuevo vuelve a la primera página.
    expect(params.has("page")).toBe(false)
    expect(options).toEqual({ scroll: false })
  })

  it("con `?taller=1` (por ejemplo desde la cifra del Panel) llega marcada y con su chip; desmarcarla quita el parámetro", () => {
    renderFilters("taller=1")
    expect(taller().checked).toBe(true)
    expect(screen.getByRole("button", { name: /Eliminar filtro Situación/ })).toBeTruthy()
    fireEvent.click(taller())
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/equipos", { scroll: false })
    expect(taller().checked).toBe(false)
  })

  it("quitar el chip quita el parámetro y la casilla vuelve a apagarse con la URL", () => {
    const view = renderFilters("taller=1")
    fireEvent.click(screen.getByRole("button", { name: /Eliminar filtro Situación/ }))
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/equipos", { scroll: false })
    // La URL cambia por otro camino que la casilla: se realinea con ella.
    nav.params = new URLSearchParams()
    view.rerender(<EquipmentFilters options={OPTIONS} canViewGps />)
    expect(taller().checked).toBe(false)
  })

  it("es independiente de «Mostrar dados de baja»: cada casilla escribe su propio parámetro", () => {
    renderFilters()
    fireEvent.click(bajas())
    expect(nav.replace).toHaveBeenLastCalledWith("/mantencion/equipos?bajas=1", { scroll: false })
    expect(taller().checked).toBe(false)
  })
})
