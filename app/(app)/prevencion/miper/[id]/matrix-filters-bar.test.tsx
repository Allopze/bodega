// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EMPTY_FILTERS } from "@/lib/prevention/miper/grid-view"

vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tarea=k1&clasificacion=important&buscar=lodo") }))

import { MatrixFiltersBar } from "./matrix-filters-bar"

const props = { riskFactors: [{ id: "f1", name: "Caídas" }], hasBaseline: false, collapsedAll: false, onToggleAll: vi.fn() }

describe("MatrixFiltersBar", () => {
  it("con sólo la búsqueda no hay chip, pero «Limpiar filtros» sigue a mano", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, search: "lodo" }} filtered />)
    expect(screen.queryByRole("button", { name: "Eliminar filtro Búsqueda" })).toBeNull()
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeTruthy()
  })
  it("un factor de la URL que no es de la matriz no genera chip", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, factorId: "basura" }} />)
    expect(screen.queryByText("Factor:")).toBeNull()
    expect(screen.queryByRole("button", { name: "Eliminar filtro Factor" })).toBeNull()
  })
  it("un factor conocido sí muestra su chip", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, factorId: "f1" }} />)
    expect(screen.getByRole("button", { name: "Eliminar filtro Factor" })).toBeTruthy()
    expect(screen.getByText("Caídas")).toBeTruthy()
  })
})

describe("MatrixFiltersBar: navegación de filtros", () => {
  // La navegación lee la URL vigente (`window.location`), no la del render: se fija la misma que trae el mock de `useSearchParams`.
  beforeEach(() => { window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k1&clasificacion=important&buscar=lodo") })
  const f = { ...EMPTY_FILTERS, classifications: ["important" as const], search: "lodo" }
  const replace = () => vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
  const last = (spy: ReturnType<typeof replace>) => new URL(String(spy.mock.calls.at(-1)?.[2]), "http://x")

  it("aplica el cambio sobre la URL vigente aunque el render traiga la anterior", () => {
    // Un `replaceState` (la búsqueda, otro filtro) cambió la URL y React todavía no volvió a pintar.
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k1&clasificacion=important&buscar=lodo&controlado=no")
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={f} />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Clasificación" }))
    const url = last(spy)
    expect(url.searchParams.get("controlado")).toBe("no")
    expect(url.searchParams.has("clasificacion")).toBe(false)
    expect(url.searchParams.get("tarea")).toBe("k1")
    spy.mockRestore()
  })
  it("quitar un chip borra sólo su clave", () => {
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={f} />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Clasificación" }))
    const url = last(spy)
    expect(url.searchParams.get("tarea")).toBe("k1")
    expect(url.searchParams.has("clasificacion")).toBe(false)
    expect(url.searchParams.get("buscar")).toBe("lodo")
    spy.mockRestore()
  })
  it("limpiar todo quita las 6 claves y conserva tarea", () => {
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={f} />)
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    const url = last(spy)
    expect(url.searchParams.get("tarea")).toBe("k1")
    for (const k of ["buscar", "clasificacion", "completitud", "controlado", "factor", "marca"]) expect(url.searchParams.has(k)).toBe(false)
    spy.mockRestore()
  })
  it("marcar una clasificación conserva tarea y suma a la lista", () => {
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={f} />)
    fireEvent.click(screen.getByRole("button", { name: /Más filtros/ }))
    fireEvent.click(screen.getByLabelText("Moderado"))
    const url = last(spy)
    expect(url.searchParams.get("tarea")).toBe("k1")
    expect(url.searchParams.get("clasificacion")).toBe("important,moderate")
    spy.mockRestore()
  })
  it("la búsqueda navega una sola vez tras 300 ms", () => {
    vi.useFakeTimers()
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS }} />)
    const input = screen.getByLabelText("Buscar en la matriz")
    fireEvent.change(input, { target: { value: "l" } })
    fireEvent.change(input, { target: { value: "lo" } })
    expect(spy).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(300) })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(last(spy).searchParams.get("buscar")).toBe("lo")
    spy.mockRestore()
    vi.useRealTimers()
  })
  it("Contraer todo queda deshabilitado con filtros", () => {
    render(<MatrixFiltersBar {...props} filters={f} filtered />)
    expect((screen.getByRole("button", { name: "Contraer todo" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
