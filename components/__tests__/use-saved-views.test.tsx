// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as React from "react"
import { render, screen, act } from "@testing-library/react"
import { useSavedViews, type SavedView } from "@/lib/hooks/use-saved-views"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/compras",
  useRouter: () => ({ replace }),
}))

function Harness({ scopeKey }: { scopeKey: string }) {
  const { views, saveCurrent, remove, apply } = useSavedViews(scopeKey)
  return (
    <div>
      <button onClick={() => saveCurrent("Pendientes Mininco")}>guardar</button>
      <button onClick={() => saveCurrent("   ")}>guardar-vacio</button>
      <ul>
        {views.map((v) => (
          <li key={v.id} data-testid="view">
            {v.name}
            <button onClick={() => remove(v.id)}>quitar-{v.name}</button>
            <button onClick={() => apply(v)}>aplicar-{v.name}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

describe("useSavedViews", () => {
  beforeEach(() => {
    localStorage.clear()
    replace.mockClear()
    window.history.pushState({}, "", "/compras?estado=pendiente&faena=ws-1")
  })

  it("guarda la vista con la URL actual y la lista sin recargar", () => {
    render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar").click())

    const stored = JSON.parse(localStorage.getItem("saved-views:compras")!) as SavedView[]
    expect(stored).toHaveLength(1)
    expect(stored[0]!.name).toBe("Pendientes Mininco")
    expect(stored[0]!.search).toBe("?estado=pendiente&faena=ws-1")
    expect(screen.getAllByTestId("view")).toHaveLength(1)
  })

  it("aplicar navega con router.replace a la URL guardada, sin scroll", () => {
    render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar").click())
    act(() => screen.getByText("aplicar-Pendientes Mininco").click())

    expect(replace).toHaveBeenCalledWith("/compras?estado=pendiente&faena=ws-1", { scroll: false })
  })

  it("quitar elimina sólo esa vista", () => {
    render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar").click())
    act(() => screen.getByText("quitar-Pendientes Mininco").click())

    expect(screen.queryAllByTestId("view")).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem("saved-views:compras")!)).toEqual([])
  })

  it("no mezcla vistas entre scopes distintos", () => {
    const { rerender } = render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar").click())

    rerender(<Harness scopeKey="solicitudes" />)
    expect(screen.queryAllByTestId("view")).toHaveLength(0)
  })

  it("ignora nombres vacíos o de sólo espacios", () => {
    render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar-vacio").click())
    expect(readAll()).toHaveLength(0)
  })

  it("recorta al tope (FIFO) en vez de bloquear el guardado", () => {
    const many: SavedView[] = Array.from({ length: 20 }, (_, i) => ({
      id: `v${i}`, name: `Vista ${i}`, search: "", createdAt: new Date().toISOString(),
    }))
    localStorage.setItem("saved-views:compras", JSON.stringify(many))
    render(<Harness scopeKey="compras" />)
    act(() => screen.getByText("guardar").click())

    const stored = readAll()
    expect(stored).toHaveLength(20)
    expect(stored[0]!.name).toBe("Vista 1") // la más antigua (Vista 0) cedió el lugar
    expect(stored[19]!.name).toBe("Pendientes Mininco")
  })

  it("un localStorage corrupto degrada a lista vacía en vez de romper", () => {
    localStorage.setItem("saved-views:compras", "{not json")
    render(<Harness scopeKey="compras" />)
    expect(screen.queryAllByTestId("view")).toHaveLength(0)
  })
})

function readAll(): SavedView[] {
  return JSON.parse(localStorage.getItem("saved-views:compras") ?? "[]")
}
