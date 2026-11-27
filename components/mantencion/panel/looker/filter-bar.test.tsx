// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LookerFilters, LookerOptions, LookerTab } from "@/lib/services/mantencion/looker/types"
import { tabHref } from "@/lib/services/mantencion/looker/filter-hrefs"

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { LookerFilterBar } from "./filter-bar"

const OPTIONS: LookerOptions = { worksites: [{ id: "ws-1", name: "Cabrero" }, { id: "ws-2", name: "Teno" }], equipment: [], frequencies: [] }

function filters(tab: LookerTab, unit: "km" | "h" = "km"): LookerFilters {
  return {
    tab, unit, from: "2026-01-01", to: "2026-10-31", requestedFrom: "2026-01-01", requestedTo: "2026-10-31", invalidPeriod: false,
    worksiteIds: ["ws-1"], equipmentIds: [], frequencies: [], page: 1, cross: {},
    planningState: null, dateField: "proxima", dateFrom: null, dateTo: null, invalidDateRange: false, sheetVehicleId: null, sheetCheckId: null,
  }
}
const CHIPS = [{ key: "faena:ws-1", label: "Faena", value: "ws-1", displayValue: "Cabrero", param: "faena" }]

function bar(tab: LookerTab, unit: "km" | "h" = "km", children?: React.ReactNode) {
  return render(<LookerFilterBar filters={filters(tab, unit)} options={OPTIONS} cross={{}} chips={CHIPS}>{children}</LookerFilterBar>)
}

beforeEach(() => {
  nav.search = ""
  nav.replace.mockClear()
})
afterEach(cleanup)

describe("LookerFilterBar · período (PAN4-6)", () => {
  it("Planificación no muestra el control de período, pero sí la faena, el equipo y la frecuencia", () => {
    bar("planificacion")
    expect(screen.queryByRole("group", { name: "Período" })).toBeNull()
    expect(screen.getByRole("button", { name: /^Faena:/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Equipo:/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Frecuencia:/ })).toBeTruthy()
  })

  it("las otras pestañas lo siguen mostrando", () => {
    for (const tab of ["correctivo", "preventivo"] as const) {
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
    nav.search = "pestana=correctivo&unidad=h&desde=2026-01-01&hasta=2026-10-31&faena=ws-1"
    bar("correctivo", "h")
    fireEvent.click(screen.getByRole("button", { name: "Borrar filtros" }))
    // La unidad no es un filtro: queda.
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=correctivo&unidad=h", { scroll: false })
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
    expect(tabHref("/mantencion/panel", "correctivo", current)).toBe("/mantencion/panel?pestana=correctivo&desde=2026-01-01&hasta=2026-10-31&faena=ws-1%2Cws-2")
  })
})

describe("LookerFilterBar · unidad de control", () => {
  it("ofrece «Por kilómetros» y «Por horas» como enlaces, marca la vigente y suelta lo que nombra un equipo", () => {
    nav.search = "pestana=preventivo&faena=ws-1&equipo=v-1&ficha=v-1&pauta=r:1&x_equipo=v-1"
    bar("preventivo")
    const km = screen.getByRole("link", { name: "Por kilómetros" })
    const hours = screen.getByRole("link", { name: "Por horas" })
    expect(km.getAttribute("aria-current")).toBe("page")
    expect(hours.getAttribute("aria-current")).toBeNull()
    expect(hours.getAttribute("href")).toBe("/mantencion/panel?pestana=preventivo&faena=ws-1&unidad=h")
  })

  it("los controles propios de la pestaña van en la barra (el filtro por fechas de Planificación)", () => {
    bar("planificacion", "km", <span>Filtro por fechas</span>)
    expect(screen.getByText("Filtro por fechas")).toBeTruthy()
  })
})
