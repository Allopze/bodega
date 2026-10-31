// @vitest-environment jsdom
/**
 * Filtros de «Por revisar»: el selector del estado del caso (abierto, tomada,
 * reabierto) junto al de gravedad, sólo en los casos pendientes; cada elección
 * escribe la URL sin mover el scroll y vuelve a la primera página.
 */
import type { ComponentProps } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActiveFilterChip } from "@/components/ui/filter-toolbar"

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/combustibles/revisar",
  useSearchParams: () => nav.params,
}))

import { InboxFilterBar } from "./inbox-filter-bar"

const WORKSITES = [{ id: "ws-1", name: "Faena Norte" }]
const STATE_FILTER = { name: "Filtrar por estado del caso" }

function renderBar(props: Partial<ComponentProps<typeof InboxFilterBar>> = {}) {
  return render(<InboxFilterBar worksites={WORKSITES} showSeverity showState chips={[]} {...props} />)
}

/** La URL a la que navegó el último `router.replace`, ya desarmada. */
function lastUrl() {
  const [url, options] = nav.replace.mock.calls.at(-1)!
  return { params: new URL(url, "http://x").searchParams, options }
}

beforeEach(() => {
  nav.params = new URLSearchParams("tipo=caso&periodo=2026-10")
  nav.replace.mockReset()
})
afterEach(() => cleanup())

describe("selector del estado del caso", () => {
  it("se ofrece junto al de gravedad, con «Cualquier estado» de partida", () => {
    renderBar()

    expect(screen.getByRole("combobox", { name: "Filtrar por gravedad" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", STATE_FILTER)).toHaveTextContent("Cualquier estado")
  })

  it("lista sólo los tres estados abiertos, con sus rótulos y sin los cerrados", () => {
    renderBar()

    fireEvent.click(screen.getByRole("combobox", STATE_FILTER))

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Cualquier estado", "Abierto", "Tomada", "Reabierto"])
  })

  it("elegir un estado escribe `estado` en la URL, sin mover el scroll, y conserva el tipo y el período", () => {
    nav.params = new URLSearchParams("tipo=caso&periodo=2026-10&pagina=3&item=caso%3Ac-1")
    renderBar()

    fireEvent.click(screen.getByRole("combobox", STATE_FILTER))
    fireEvent.click(screen.getByRole("option", { name: "Tomada" }))

    expect(nav.replace).toHaveBeenCalledTimes(1)
    const { params, options } = lastUrl()
    expect(options).toEqual({ scroll: false })
    expect(params.get("estado")).toBe("in_review")
    expect(params.get("tipo")).toBe("caso")
    expect(params.get("periodo")).toBe("2026-10")
    // Vuelve a la primera página y cierra la hoja que estuviera abierta.
    expect(params.has("pagina")).toBe(false)
    expect(params.has("item")).toBe(false)
  })

  it("muestra el estado de la URL y «Cualquier estado» lo quita", () => {
    nav.params = new URLSearchParams("tipo=caso&estado=reopened&severidad=high")
    renderBar()

    const trigger = screen.getByRole("combobox", STATE_FILTER)
    expect(trigger).toHaveTextContent("Reabierto")

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("option", { name: "Cualquier estado" }))

    const { params } = lastUrl()
    expect(params.has("estado")).toBe(false)
    expect(params.get("severidad")).toBe("high")
  })

  it("un `estado` que no es de un caso abierto se lee como «Cualquier estado»", () => {
    nav.params = new URLSearchParams("tipo=caso&estado=resolved")
    renderBar()

    expect(screen.getByRole("combobox", STATE_FILTER)).toHaveTextContent("Cualquier estado")
  })

  it("fuera de los casos pendientes no hay selector de estado ni de gravedad", () => {
    renderBar({ showSeverity: false, showState: false })

    expect(screen.queryByRole("combobox", STATE_FILTER)).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Filtrar por gravedad" })).toBeNull()
  })

  it("sin ningún filtro que ofrecer ni chips, la barra no se pinta", () => {
    const { container } = renderBar({ worksites: [], showSeverity: false, showState: false })

    expect(container).toBeEmptyDOMElement()
  })

  it("el chip del estado se quita solo y «Limpiar filtros» quita estado y carga, pero no el tipo ni el período", () => {
    nav.params = new URLSearchParams("tipo=caso&periodo=2026-10&estado=in_review&ref=tae_pwa%3Asub-1&severidad=high")
    const chips: ActiveFilterChip[] = [
      { key: "estado", label: "Estado", value: "in_review", displayValue: "Tomada" },
      { key: "ref", label: "Carga", value: "tae_pwa:sub-1", displayValue: "Sólo los casos de la carga elegida" },
    ]
    renderBar({ chips })

    // Cada chip se lee «rótulo: valor», en palabras (nada de «Registro de origen» ni valores crudos).
    const chip = (label: string) => screen.getByRole("button", { name: `Eliminar filtro ${label}` }).closest("span")
    expect(chip("Estado")).toHaveTextContent("Estado:Tomada")
    expect(chip("Carga")).toHaveTextContent("Carga:Sólo los casos de la carga elegida")

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Estado" }))
    expect(lastUrl().params.has("estado")).toBe(false)
    expect(lastUrl().params.get("ref")).toBe("tae_pwa:sub-1")

    nav.replace.mockClear()
    fireEvent.click(screen.getByRole("button", { name: /limpiar filtros/i }))
    const { params } = lastUrl()
    expect(params.toString()).toBe("tipo=caso&periodo=2026-10")
  })
})
