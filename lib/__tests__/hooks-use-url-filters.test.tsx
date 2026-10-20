// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// El router de Next es estable entre renders; el mock también, o la prueba de estabilidad medería el mock.
const nav = vi.hoisted(() => {
  const replace = vi.fn()
  return { params: new URLSearchParams(), replace, router: { replace } }
})
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones",
}))

import { useUrlFilters } from "@/lib/hooks/use-url-filters"

beforeEach(() => {
  nav.params = new URLSearchParams("estado=planned&page=3")
  nav.replace.mockReset()
})

describe("useUrlFilters", () => {
  it("sigue escribiendo la URL con router.replace y sin mover el scroll", () => {
    const { result } = renderHook(() => useUrlFilters())
    act(() => result.current.setFilters({ tipo: "audit" }))
    // `replace` y `scroll: false`: es el patrón de filtros de AGENTS.md. Envolver la navegación en
    // una transición para `isPending` no puede cambiarlo.
    expect(nav.replace).toHaveBeenCalledTimes(1)
    const [url, options] = nav.replace.mock.calls[0]!
    expect(options).toEqual({ scroll: false })
    // La clave de página se reinicia con el filtro nuevo y lo demás se conserva.
    expect(new URL(String(url), "http://x").searchParams.toString()).toBe("estado=planned&tipo=audit")
  })

  it("setFilter y clearFilters pasan por el mismo camino", () => {
    const { result } = renderHook(() => useUrlFilters())
    act(() => result.current.setFilter("faena", "ws-1"))
    expect(nav.replace.mock.calls.at(-1)).toEqual(["/prevencion/inspecciones?estado=planned&faena=ws-1", { scroll: false }])
    act(() => result.current.clearFilters(["estado"]))
    expect(nav.replace.mock.calls.at(-1)).toEqual(["/prevencion/inspecciones?estado=planned", { scroll: false }])
    act(() => result.current.clearFilters())
    expect(nav.replace.mock.calls.at(-1)).toEqual(["/prevencion/inspecciones", { scroll: false }])
  })

  it("respeta `scroll: true` cuando quien lo usa lo pide", () => {
    const { result } = renderHook(() => useUrlFilters({ scroll: true }))
    act(() => result.current.setFilters({ tipo: "audit" }))
    expect(nav.replace.mock.calls[0]![1]).toEqual({ scroll: true })
  })

  it("expone `isPending`, en falso mientras no hay una navegación en curso", () => {
    const { result } = renderHook(() => useUrlFilters())
    expect(result.current.isPending).toBe(false)
    act(() => result.current.setFilters({ tipo: "audit" }))
    // Con un `replace` síncrono la transición ya terminó; el valor vuelve a falso.
    expect(result.current.isPending).toBe(false)
  })

  it("las funciones se mantienen estables entre renders si la URL no cambia", () => {
    const { result, rerender } = renderHook(() => useUrlFilters())
    const before = result.current.setFilters
    rerender()
    // Quien las usa como dependencia de un efecto (el buscador con debounce) no se reinicia en cada render.
    expect(result.current.setFilters).toBe(before)
  })
})
