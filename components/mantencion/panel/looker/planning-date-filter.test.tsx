// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: { current: "pestana=planificacion" } }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search.current),
}))

import { PlanningDateFilter } from "./planning-date-filter"

const TODAY = "2026-11-27"

function renderFilter(filters: Partial<Parameters<typeof PlanningDateFilter>[0]["filters"]> = {}) {
  return render(<PlanningDateFilter today={TODAY} filters={{ dateField: "proxima", dateFrom: null, dateTo: null, ...filters }} />)
}

beforeEach(() => {
  nav.replace.mockReset()
  nav.search.current = "pestana=planificacion"
})
afterEach(cleanup)

describe("PlanningDateFilter", () => {
  it("elige qué fecha filtra y marca la vigente", () => {
    renderFilter()
    expect(screen.getByRole("button", { name: "Próxima mantención (estimada)" }).getAttribute("aria-pressed")).toBe("true")
    const last = screen.getByRole("button", { name: "Última mantención" })
    expect(last.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(last)
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=planificacion&fecha=ultima", { scroll: false })
  })

  it("los atajos «Próximos N días» incluyen las vencidas: sólo fijan el término, y el segundo clic lo quita", () => {
    renderFilter()
    const group = screen.getByRole("group", { name: "Atajos (incluyen las vencidas)" })
    expect(group).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Próximos 30 días" }))
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=planificacion&fecha_hasta=2026-12-27", { scroll: false })

    cleanup()
    nav.replace.mockReset()
    nav.search.current = "pestana=planificacion&fecha_hasta=2026-12-27"
    renderFilter({ dateTo: "2026-12-27" })
    const active = screen.getByRole("button", { name: "Próximos 30 días" })
    expect(active.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Próximos 7 días" }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(active)
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=planificacion", { scroll: false })
  })

  it("con la fecha de la última mantención no hay atajos hacia adelante", () => {
    nav.search.current = "pestana=planificacion&fecha=ultima"
    renderFilter({ dateField: "ultima" })
    expect(screen.queryByRole("group", { name: "Atajos (incluyen las vencidas)" })).toBeNull()
    expect(screen.getByRole("button", { name: "Última mantención" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("el rango usa el control de período del sistema, con `fecha_desde` y `fecha_hasta`", () => {
    nav.search.current = "pestana=planificacion&fecha_desde=2026-12-01&fecha_hasta=2026-12-31"
    renderFilter({ dateFrom: "2026-12-01", dateTo: "2026-12-31" })
    expect(screen.getByRole("group", { name: "Rango de fechas" })).toBeTruthy()
    expect(screen.getByText("Diciembre 2026")).toBeTruthy()
    expect(document.querySelector("input[type=date]")).toBeNull()
  })
})
