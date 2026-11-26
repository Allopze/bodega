// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerFilters, LookerOptions, LookerTab } from "@/lib/services/mantencion/looker/types"
import { tabHref } from "@/lib/services/mantencion/looker/filters"

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { LookerFilterBar } from "./filter-bar"

const OPTIONS: LookerOptions = { worksites: [{ id: "ws-1", name: "Cabrero" }, { id: "ws-2", name: "Teno" }], equipment: [], frequencies: [] }

function filters(tab: LookerTab): LookerFilters {
  return {
    tab, from: "2026-01-01", to: "2026-10-31", requestedFrom: "2026-01-01", requestedTo: "2026-10-31", invalidPeriod: false,
    worksiteIds: ["ws-1"], equipmentIds: [], frequencies: [], page: 1, cross: {},
  }
}
const CHIPS = [{ key: "faena:ws-1", label: "Faena", value: "ws-1", displayValue: "Cabrero", param: "faena" }]

function bar(tab: LookerTab) {
  return render(<LookerFilterBar filters={filters(tab)} options={OPTIONS} cross={{}} chips={CHIPS} />)
}

beforeEach(() => {
  nav.search = ""
  nav.replace.mockClear()
})
afterEach(cleanup)

describe("LookerFilterBar · período (PAN4-6)", () => {
  it("Planificación no muestra el control de período, pero sí la faena, el código y la frecuencia", () => {
    bar("planificacion")
    expect(screen.queryByRole("group", { name: "Período" })).toBeNull()
    expect(screen.getByRole("button", { name: /^Faena:/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Código:/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Frecuencia:/ })).toBeTruthy()
  })

  it("las otras pestañas lo siguen mostrando", () => {
    for (const tab of ["camiones", "maquinas"] as const) {
      bar(tab)
      expect(screen.getByRole("group", { name: "Período" }), tab).toBeTruthy()
      cleanup()
    }
  })

  it("«Borrar filtros» en Planificación quita la faena pero no el período que se eligió en otra pestaña", () => {
    nav.search = "pestana=planificacion&desde=2026-01-01&hasta=2026-10-31&faena=ws-1&x_equipo=v-1"
    bar("planificacion")
    fireEvent.click(screen.getByRole("button", { name: "Borrar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=planificacion&desde=2026-01-01&hasta=2026-10-31", { scroll: false })
  })

  it("en Planificación sin período en la URL, «Borrar filtros» deja sólo la pestaña", () => {
    nav.search = "pestana=planificacion&faena=ws-1"
    bar("planificacion")
    fireEvent.click(screen.getByRole("button", { name: "Borrar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=planificacion", { scroll: false })
  })

  it("en las otras pestañas «Borrar filtros» sigue llevando el período a su valor por defecto", () => {
    nav.search = "pestana=camiones&desde=2026-01-01&hasta=2026-10-31&faena=ws-1"
    bar("camiones")
    fireEvent.click(screen.getByRole("button", { name: "Borrar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=camiones", { scroll: false })
  })

  it("cambiar la faena en Planificación conserva el período de la URL, y el enlace a otra pestaña lo lleva", () => {
    nav.search = "pestana=planificacion&desde=2026-01-01&hasta=2026-10-31&faena=ws-1"
    bar("planificacion")
    fireEvent.click(screen.getByRole("button", { name: "Faena: Cabrero" }))
    fireEvent.click(screen.getByRole("checkbox", { name: /Teno/ }))
    const href = String(nav.replace.mock.calls.at(-1)?.[0])
    const params = new URL(href, "http://x").searchParams
    expect([params.get("desde"), params.get("hasta"), params.get("faena")]).toEqual(["2026-01-01", "2026-10-31", "ws-1,ws-2"])
    // El período que no se ve sigue en la dirección: la pestaña vecina lo recibe tal cual.
    const current = Object.fromEntries(params.entries())
    expect(tabHref("/mantencion/panel", "camiones", current)).toBe("/mantencion/panel?pestana=camiones&desde=2026-01-01&hasta=2026-10-31&faena=ws-1%2Cws-2")
  })
})
