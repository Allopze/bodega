// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FleetTable } from "./fleet-table"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/flota",
}))

/**
 * P-9: la tarjeta móvil de Flota no mostraba «Km/Hr» (la tabla de escritorio sí). Las dos vistas viven en
 * el DOM a la vez (`md:hidden` y `hidden md:block`), así que la tarjeta se busca por su rol `article`.
 */
const base = {
  type: "Camión", brand: "Volvo", model: "FH", year: 2020, worksiteName: "Faena A", isActive: true, operationalStatus: "operativo",
  responsibleName: "Ana", nextExpiryDate: null, totalLiters: 100, loadCount: 3, totalFuelAmount: 90_000,
  openWorkOrders: null, inWorkshopNow: null, lastOdometerReading: null, lastHourMeterReading: null, lastReadingAt: null, lastReadingObjection: null,
}
const LIMPIA = { ...base, id: "v1", plate: "AA-0001", lastOdometerReading: 52_000, lastReadingAt: "2026-10-12T15:00:00.000Z" }
const OBJETADA = {
  ...base, id: "v2", plate: "AA-0002", lastOdometerReading: 1_030, lastReadingAt: "2026-10-13T15:00:00.000Z",
  lastReadingObjection: { caseId: "case-2", ruleLabel: "Kilometraje regresivo" },
}
const HOROMETRO = { ...base, id: "v3", plate: "AA-0003", lastHourMeterReading: 120.5, lastReadingAt: "2026-10-14T15:00:00.000Z" }
const SIN_LECTURA = { ...base, id: "v4", plate: "AA-0004" }

type Vehicles = Parameters<typeof FleetTable>[0]["vehicles"]
const renderTable = (vehicles: unknown[], canViewFuel = true) =>
  render(<FleetTable vehicles={vehicles as Vehicles} hasAnyVehicle canViewCosts canViewFuel={canViewFuel} />)

const card = (plate: string) => screen.getAllByRole("article").find((article) => within(article).queryByText(plate))!

describe("FleetTable · tarjeta móvil", () => {
  it("muestra «Km/Hr» con la última lectura: el odómetro en km y, a falta de él, el horómetro en h", () => {
    renderTable([LIMPIA, HOROMETRO])

    expect(within(card("AA-0001")).getByText("Km/Hr")).toBeInTheDocument()
    expect(within(card("AA-0001")).getByText("52.000 km")).toBeInTheDocument()
    expect(within(card("AA-0003")).getByText("120,5 h")).toBeInTheDocument()
  })

  it("lleva la misma marca de lectura objetada que la tabla: el enlace al caso, con la cifra a su lado", () => {
    renderTable([LIMPIA, OBJETADA])

    const objected = card("AA-0002")
    expect(within(objected).getByText("1.030 km")).toBeInTheDocument()
    expect(within(objected).getByRole("link", { name: "Lectura objetada: revisar caso" })).toHaveAttribute("href", expect.stringContaining("case-2"))
    expect(within(card("AA-0001")).queryByRole("link", { name: "Lectura objetada: revisar caso" })).toBeNull()
  })

  it("un equipo sin lectura dice «—» (la tabla también), no un cero", () => {
    renderTable([LIMPIA, SIN_LECTURA])

    const dd = within(card("AA-0004")).getByText("Km/Hr").closest("div")!
    expect(within(dd).getByText("—")).toBeInTheDocument()
    expect(within(card("AA-0004")).queryByText(/\d+ km|\d+ h$/)).toBeNull()
  })

  it("con la misma condición que la columna de la tabla: sin combustibles:view, o si ningún equipo tiene lectura, no hay «Km/Hr»", () => {
    const { unmount } = renderTable([LIMPIA], false)
    expect(within(card("AA-0001")).queryByText("Km/Hr")).toBeNull()
    unmount()

    renderTable([SIN_LECTURA, { ...SIN_LECTURA, id: "v5", plate: "AA-0005" }])
    expect(within(card("AA-0004")).queryByText("Km/Hr")).toBeNull()
  })
})
