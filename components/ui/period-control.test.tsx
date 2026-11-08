// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addDaysToPlainDate, trailingDaysRange } from "@/lib/utils"

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), pathname: "/control-operacional", search: "" }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import {
  PeriodControl,
  defaultRangePresets,
  isPlainDate,
  monthRange,
  rangeNeighbours,
  rangePeriodLabel,
  shiftDateRange,
  type RangePeriodControlProps,
} from "./period-control"

const TODAY = "2026-11-06"
const DEFAULT_FROM = addDaysToPlainDate(TODAY, -89)
const DEFAULT_RANGE = { from: DEFAULT_FROM, to: TODAY, label: "los últimos 90 días" }

beforeEach(() => {
  nav.replace.mockClear()
  nav.push.mockClear()
  nav.pathname = "/control-operacional"
  nav.search = ""
})
afterEach(() => cleanup())

function renderRange(props: Partial<Omit<RangePeriodControlProps, "mode">> = {}) {
  return render(<PeriodControl mode="range" from={DEFAULT_FROM} to={TODAY} today={TODAY} defaultRange={DEFAULT_RANGE} {...props} />)
}
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /Cambiar período/ }))
const lastUrl = () => nav.replace.mock.calls.at(-1)?.[0] as string
const lastOptions = () => nav.replace.mock.calls.at(-1)?.[1]

describe("rangos de fechas civiles", () => {
  it("un mes completo se desplaza de mes a mes, también entre años", () => {
    expect(shiftDateRange(monthRange(2026, 10), 1)).toEqual({ from: "2026-11-01", to: "2026-11-30" })
    expect(shiftDateRange(monthRange(2026, 1), -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" })
    expect(shiftDateRange(monthRange(2026, 3), -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })

  it("cualquier otro rango se desplaza por su propio largo, sin dejar huecos ni solaparse", () => {
    const range = { from: "2026-08-09", to: "2026-11-06" }
    const previous = shiftDateRange(range, -1)
    expect(previous.to).toBe("2026-08-08")
    expect(addDaysToPlainDate(previous.to, 1)).toBe(range.from)
    const following = shiftDateRange(range, 1)
    expect(following.from).toBe("2026-11-07")
    // 90 días antes y 90 días después.
    expect(previous.from).toBe(addDaysToPlainDate(range.from, -90))
    expect(following.to).toBe(addDaysToPlainDate(range.to, 90))
  })

  it("la flecha de adelante se apaga cuando el siguiente empezaría después de hoy", () => {
    expect(rangeNeighbours({ from: DEFAULT_FROM, to: TODAY }, TODAY).next).toBeNull()
    expect(rangeNeighbours({ from: DEFAULT_FROM, to: TODAY }, TODAY).prev).not.toBeNull()
    expect(rangeNeighbours(monthRange(2026, 10), TODAY).next).toEqual(monthRange(2026, 11))
    expect(rangeNeighbours(monthRange(2026, 11), TODAY).next).toBeNull()
  })

  it("un rango roto en la URL no desplaza nada ni lanza", () => {
    expect(rangeNeighbours({ from: "garbage", to: TODAY }, TODAY)).toEqual({ prev: null, next: null })
    expect(rangeNeighbours({ from: TODAY, to: DEFAULT_FROM }, TODAY)).toEqual({ prev: null, next: null })
    expect(isPlainDate("2026-02-30")).toBe(false)
    expect(isPlainDate("2026-02-28")).toBe(true)
    expect(rangePeriodLabel({ from: "x", to: "y" }, TODAY)).toBe("Elegir período")
  })

  it("rotula un mes completo por su nombre y el resto por sus fechas (con año si no es el actual)", () => {
    expect(rangePeriodLabel(monthRange(2026, 10), TODAY)).toBe("Octubre 2026")
    expect(rangePeriodLabel({ from: "2026-09-15", to: "2026-10-15" }, TODAY)).toBe("15 sep – 15 oct")
    expect(rangePeriodLabel({ from: "2025-12-20", to: "2026-01-05" }, TODAY)).toBe("20 dic 2025 – 5 ene 2026")
  })

  it("los accesos rápidos incluyen el rango por defecto de Control operacional", () => {
    const presets = defaultRangePresets(TODAY)
    expect(presets.find((preset) => preset.key === "90d")?.period).toEqual({ from: DEFAULT_FROM, to: TODAY })
    expect(presets.find((preset) => preset.key === "mes-anterior")?.period).toEqual(monthRange(2026, 10))
    expect(presets.find((preset) => preset.key === "mes")?.period).toEqual(monthRange(2026, 11))
  })

  it("«Últimos N días» son N días corridos con hoy incluido, la misma definición que usa Analítica", () => {
    const presets = defaultRangePresets(TODAY)
    expect(presets.find((preset) => preset.key === "30d")?.period).toEqual({ from: "2026-10-08", to: TODAY })
    expect(presets.find((preset) => preset.key === "30d")?.period).toEqual(trailingDaysRange(30, TODAY))
    expect(presets.find((preset) => preset.key === "12m")?.period).toEqual({ from: addDaysToPlainDate(TODAY, -364), to: TODAY })
  })
})

describe("PeriodControl · rango", () => {
  it("es un grupo «Período» con las flechas y el período vigente", () => {
    renderRange()
    const group = screen.getByRole("group", { name: "Período" })
    expect(within(group).getByRole("button", { name: "Período anterior" })).toBeEnabled()
    expect(within(group).getByRole("button", { name: "Período siguiente" })).toBeDisabled()
    expect(within(group).getByRole("button", { name: /Cambiar período/ })).toHaveTextContent("9 ago – 6 nov")
  })

  it("la flecha de atrás navega con replace y sin mover el scroll, y vuelve a la primera página", () => {
    nav.search = "faena=ws-1&page=3&pagina=2"
    renderRange()
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    const params = new URLSearchParams(lastUrl().split("?")[1])
    expect(lastUrl().startsWith("/control-operacional?")).toBe(true)
    expect(params.get("desde")).toBe("2026-05-11")
    expect(params.get("hasta")).toBe("2026-08-08")
    expect(params.get("faena")).toBe("ws-1")
    expect(params.has("page")).toBe(false)
    expect(params.has("pagina")).toBe(false)
    expect(lastOptions()).toEqual({ scroll: false })
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("un acceso rápido aplica al hacer clic, sin botón «Aplicar período»", () => {
    renderRange()
    openPanel()
    expect(screen.queryByRole("button", { name: /Aplicar período/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" }))
    const params = new URLSearchParams(lastUrl().split("?")[1])
    expect(params.get("desde")).toBe(addDaysToPlainDate(TODAY, -29))
    expect(params.get("hasta")).toBe(TODAY)
    expect(lastOptions()).toEqual({ scroll: false })
  })

  it("marca como activo el acceso rápido que coincide con el rango vigente", () => {
    renderRange()
    openPanel()
    expect(screen.getByRole("button", { name: "Últimos 90 días" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute("aria-pressed", "false")
  })

  it("elegir un mes de la grilla aplica el mes completo", () => {
    renderRange()
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Oct" }))
    const params = new URLSearchParams(lastUrl().split("?")[1])
    expect(params.get("desde")).toBe("2026-10-01")
    expect(params.get("hasta")).toBe("2026-10-31")
  })

  it("no ofrece meses futuros ni un año futuro", () => {
    renderRange()
    openPanel()
    expect(screen.getByRole("button", { name: "Dic" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Nov" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Año siguiente" })).toBeDisabled()
  })

  it("el rango personalizado trae su propio «Aplicar rango», con los campos rotulados", () => {
    renderRange({ from: "2026-09-15", to: "2026-10-15" })
    openPanel()
    expect(screen.getByText("Desde")).toBeInTheDocument()
    expect(screen.getByText("Hasta")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Aplicar rango" }))
    const params = new URLSearchParams(lastUrl().split("?")[1])
    expect(params.get("desde")).toBe("2026-09-15")
    expect(params.get("hasta")).toBe("2026-10-15")
  })

  it("usa los parámetros de URL que se le piden (Analítica: from/to)", () => {
    nav.pathname = "/analitica"
    nav.search = "proveedor=p1&desde=basura"
    renderRange({ fromParam: "from", toParam: "to" })
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    const [path, query] = lastUrl().split("?")
    const params = new URLSearchParams(query)
    expect(path).toBe("/analitica")
    expect(params.has("from") && params.has("to")).toBe(true)
    expect(params.get("proveedor")).toBe("p1")
    // `desde` no es su parámetro: no lo toca.
    expect(params.get("desde")).toBe("basura")
  })

  it("«Volver a…» aparece sólo si el rango no es el de por defecto y quita el período de la URL", () => {
    nav.search = "faena=ws-1&desde=2026-05-11&hasta=2026-08-08"
    renderRange({ from: "2026-05-11", to: "2026-08-08" })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Volver a los últimos 90 días" }))
    expect(lastUrl()).toBe("/control-operacional?faena=ws-1")
    expect(lastOptions()).toEqual({ scroll: false })
  })

  it("sin otro parámetro, volver al valor por defecto deja la ruta limpia", () => {
    nav.search = "desde=2026-05-11&hasta=2026-08-08"
    renderRange({ from: "2026-05-11", to: "2026-08-08" })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Volver a los últimos 90 días" }))
    expect(lastUrl()).toBe("/control-operacional")
  })

  it("con el rango por defecto no ofrece «Volver a…»", () => {
    renderRange()
    openPanel()
    expect(screen.queryByRole("button", { name: /Volver a/ })).toBeNull()
  })

  it("un rango inválido en la URL no tumba el control", () => {
    renderRange({ from: "garbage", to: "2026-13-45" })
    expect(screen.getByRole("button", { name: /Cambiar período/ })).toHaveTextContent("Elegir período")
    expect(screen.getByRole("button", { name: "Período anterior" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Período siguiente" })).toBeDisabled()
    openPanel()
    expect(screen.getByRole("button", { name: "Aplicar rango" })).toBeDisabled()
  })

  it("no toca window.history: persistir el período es cosa del módulo, no del control genérico", () => {
    const replaceState = vi.spyOn(window.history, "replaceState")
    const pushState = vi.spyOn(window.history, "pushState")
    renderRange()
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" }))
    expect(replaceState).not.toHaveBeenCalled()
    expect(pushState).not.toHaveBeenCalled()
    replaceState.mockRestore()
    pushState.mockRestore()
  })
})

describe("PeriodControl · mes", () => {
  function renderMonth(month: string) {
    return render(<PeriodControl mode="month" month={month} today={TODAY} />)
  }

  it("rotula el mes y navega al anterior con ?periodo=YYYY-MM", () => {
    nav.pathname = "/facturacion"
    nav.search = "pago=paid&page=2"
    renderMonth("2026-10")
    expect(screen.getByRole("button", { name: /Cambiar período/ })).toHaveTextContent("Octubre 2026")
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    expect(lastUrl()).toBe("/facturacion?pago=paid&periodo=2026-09")
    expect(lastOptions()).toEqual({ scroll: false })
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("la flecha de adelante se apaga en el mes actual", () => {
    renderMonth("2026-11")
    expect(screen.getByRole("button", { name: "Período siguiente" })).toBeDisabled()
    cleanup()
    renderMonth("2026-10")
    expect(screen.getByRole("button", { name: "Período siguiente" })).toBeEnabled()
  })

  it("cruza el cambio de año hacia atrás", () => {
    renderMonth("2026-01")
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    expect(lastUrl()).toBe("/control-operacional?periodo=2025-12")
  })

  it("no ofrece rango personalizado: un mes es la unidad", () => {
    renderMonth("2026-10")
    openPanel()
    expect(screen.queryByRole("heading", { name: "Rango de fechas" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Aplicar rango" })).toBeNull()
  })

  it("la grilla de meses y los accesos rápidos aplican al hacer clic", () => {
    renderMonth("2026-10")
    openPanel()
    expect(screen.getByRole("button", { name: "Oct" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Mar" }))
    expect(lastUrl()).toBe("/control-operacional?periodo=2026-03")
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }))
    expect(lastUrl()).toBe("/control-operacional?periodo=2026-10")
  })

  // Facturación y Documentos DTE ofrecían los últimos 24 meses (el actual y 23 más): con
  // TODAY = 2026-11 el primero es 2024-12. Sin tope la grilla retrocedía año tras año.
  describe("con minMonth", () => {
    const MIN = "2024-12"
    function renderBounded(month: string, minMonth: string = MIN) {
      return render(<PeriodControl mode="month" month={month} minMonth={minMonth} today={TODAY} />)
    }

    it("la flecha de atrás se apaga en el primer mes y un mes después sigue funcionando", () => {
      renderBounded("2024-12")
      expect(screen.getByRole("button", { name: "Período anterior" })).toBeDisabled()
      cleanup()
      renderBounded("2025-01")
      expect(screen.getByRole("button", { name: "Período anterior" })).toBeEnabled()
      fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
      expect(lastUrl()).toBe("/control-operacional?periodo=2024-12")
    })

    it("la grilla deshabilita los meses anteriores y «Año anterior» se apaga en el año del tope", () => {
      renderBounded("2025-06")
      openPanel()
      const previousYear = screen.getByRole("button", { name: "Año anterior" })
      expect(previousYear).toBeEnabled()
      fireEvent.click(previousYear)
      expect(screen.getByText("2024")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Año anterior" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Nov" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Dic" })).toBeEnabled()
      // Lo habilitado sigue aplicando.
      fireEvent.click(screen.getByRole("button", { name: "Dic" }))
      expect(lastUrl()).toBe("/control-operacional?periodo=2024-12")
    })

    it("un mes de la grilla anterior al tope no navega aunque se haga clic", () => {
      renderBounded("2024-12")
      openPanel()
      nav.replace.mockClear()
      fireEvent.click(screen.getByRole("button", { name: "Nov" }))
      expect(nav.replace).not.toHaveBeenCalled()
    })

    it("no ofrece un acceso rápido que caiga antes del tope", () => {
      renderBounded("2026-11", "2026-11")
      openPanel()
      expect(screen.getByRole("button", { name: "Este mes" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Mes anterior" })).toBeNull()
    })

    it("un minMonth mal formado no acota nada, y sin él la grilla retrocede sin tope", () => {
      renderBounded("2025-06", "2024")
      expect(screen.getByRole("button", { name: "Período anterior" })).toBeEnabled()
      openPanel()
      fireEvent.click(screen.getByRole("button", { name: "Año anterior" }))
      fireEvent.click(screen.getByRole("button", { name: "Año anterior" }))
      expect(screen.getByText("2023")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Año anterior" })).toBeEnabled()
      expect(screen.getByRole("button", { name: "Ene" })).toBeEnabled()
    })
  })
})
