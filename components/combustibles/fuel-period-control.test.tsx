// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { describeFuelPeriod, type FuelPeriod, type FuelPeriodSource } from "@/lib/combustibles/period"

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), pathname: "/combustibles/consumo", search: "" }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { FuelPeriodControl } from "./fuel-period-control"

const TODAY = "2026-11-07"

function renderControl(period: FuelPeriod, source: FuelPeriodSource = "url", granularity?: "any" | "month") {
  return render(<FuelPeriodControl resolved={describeFuelPeriod(period, source, TODAY)} {...(granularity ? { granularity } : {})} />)
}
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /Cambiar período/ }))
const lastUrl = () => nav.replace.mock.calls.at(-1)?.[0] as string
const cookie = () => decodeURIComponent(document.cookie.match(/chome_fuel_periodo=([^;]*)/)?.[1] ?? "")

beforeEach(() => {
  // `todayInChile()` lee el reloj: se fija sólo `Date` para no frenar a Radix.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"))
  nav.replace.mockClear()
  nav.pathname = "/combustibles/consumo"
  nav.search = ""
  // La cookie del período es de `/combustibles`: sólo se lee desde esa ruta.
  window.history.replaceState(null, "", "/combustibles/consumo")
  document.cookie = "chome_fuel_periodo=; Path=/combustibles; Max-Age=0"
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("FuelPeriodControl (envoltorio de PeriodControl)", () => {
  it("conserva el rótulo, las flechas y el grupo «Período»", () => {
    renderControl({ kind: "month", year: 2026, month: 10 })
    expect(screen.getByRole("group", { name: "Período" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cambiar período/ })).toHaveTextContent("Octubre 2026")
    expect(screen.getByRole("button", { name: "Período anterior" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Período siguiente" })).toBeEnabled()
  })

  it("la flecha de atrás escribe ?periodo=, limpia los filtros de fecha antiguos y la paginación, y recuerda el período", () => {
    nav.search = "anio=2025&meses=3&from=2025-01-01&to=2025-02-01&month=2025-03&startDate=a&endDate=b&desde=2026-01-01&hasta=2026-02-01&page=2&pagina=3&cargas=4&faena=ws-1&tab=x"
    renderControl({ kind: "month", year: 2026, month: 10 })
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    expect(lastUrl()).toBe("/combustibles/consumo?faena=ws-1&tab=x&periodo=2026-09")
    expect(nav.replace.mock.calls.at(-1)?.[1]).toEqual({ scroll: false })
    expect(nav.push).not.toHaveBeenCalled()
    expect(cookie()).toBe("2026-09")
  })

  it("un rango viaja en desde/hasta, sin periodo, y la cookie lo guarda como r:desde:hasta", () => {
    nav.search = "periodo=2026-10&page=2"
    renderControl({ kind: "range", from: "2026-09-15", to: "2026-10-15" })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Aplicar rango" }))
    expect(lastUrl()).toBe("/combustibles/consumo?desde=2026-09-15&hasta=2026-10-15")
    expect(cookie()).toBe("r:2026-09-15:2026-10-15")
  })

  it("los accesos rápidos son los del módulo (semana, trimestre, año) y marcan el vigente", () => {
    renderControl({ kind: "month", year: 2026, month: 11 })
    openPanel()
    for (const name of ["Esta semana", "Este mes", "Mes anterior", "Este trimestre", "Trimestre anterior", "Este año"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("button", { name: "Este mes" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Este trimestre" }))
    expect(lastUrl()).toBe("/combustibles/consumo?periodo=2026-T4")
    expect(cookie()).toBe("2026-T4")
  })

  it("una semana se desplaza por semanas (el modelo de Combustible, no el del rango genérico)", () => {
    renderControl({ kind: "week", year: 2026, week: 44 })
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    expect(lastUrl()).toBe("/combustibles/consumo?periodo=2026-S43")
  })

  it("la grilla de meses elige un mes del año mostrado", () => {
    renderControl({ kind: "month", year: 2026, month: 10 })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Año anterior" }))
    fireEvent.click(screen.getByRole("button", { name: "Mar" }))
    expect(lastUrl()).toBe("/combustibles/consumo?periodo=2025-03")
  })

  it("con granularidad «month» (estados de cuenta) sólo ofrece meses: sin rango ni semanas", () => {
    renderControl({ kind: "month", year: 2026, month: 10 }, "url", "month")
    openPanel()
    expect(screen.queryByRole("heading", { name: "Rango de fechas" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Aplicar rango" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Esta semana" })).toBeNull()
    expect(screen.getByRole("button", { name: "Este mes" })).toBeInTheDocument()
  })

  it("avisa que el período vale para todo el módulo", () => {
    renderControl({ kind: "month", year: 2026, month: 10 })
    openPanel()
    expect(screen.getByText("El período vale para todas las pantallas de Combustible y queda en el enlace.")).toBeInTheDocument()
  })

  it("no ofrece «Volver a…»: el módulo recuerda el período, no hay uno «por defecto» que restablecer", () => {
    renderControl({ kind: "month", year: 2026, month: 10 })
    openPanel()
    expect(screen.queryByRole("button", { name: /Volver a/ })).toBeNull()
  })
})

describe("FuelPeriodControl · persistencia (sólo en el envoltorio de Combustible)", () => {
  it("un período que vino de la URL se recuerda en la cookie sin tocar el historial", () => {
    const replaceState = vi.spyOn(window.history, "replaceState")
    renderControl({ kind: "month", year: 2026, month: 10 }, "url")
    expect(cookie()).toBe("2026-10")
    expect(replaceState).not.toHaveBeenCalled()
  })

  it("uno que vino de la cookie se escribe en la URL con replaceState para que el enlace se pueda compartir", () => {
    const replaceState = vi.spyOn(window.history, "replaceState")
    window.history.replaceState(null, "", "/combustibles/consumo?faena=ws-1")
    replaceState.mockClear()
    renderControl({ kind: "month", year: 2026, month: 10 }, "cookie")
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState.mock.calls[0]?.[2]).toBe("/combustibles/consumo?faena=ws-1&periodo=2026-10")
  })

  it("el período por defecto no escribe ni cookie ni URL", () => {
    const replaceState = vi.spyOn(window.history, "replaceState")
    renderControl({ kind: "month", year: 2026, month: 10 }, "default")
    expect(cookie()).toBe("")
    expect(replaceState).not.toHaveBeenCalled()
  })
})
