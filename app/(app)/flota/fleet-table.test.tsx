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
  code: null, responsibleName: "Ana", nextExpiryDate: null, nextExpiryDocumentType: null, totalLiters: 100, loadCount: 3, totalFuelAmount: 90_000,
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
// El servidor pasa el día de Chile y la ventana de aviso de los ajustes de flota (30 por defecto).
const TODAY = "2026-11-05"
const renderTable = (vehicles: unknown[], canViewFuel = true) =>
  render(<FleetTable vehicles={vehicles as Vehicles} hasAnyVehicle canViewCosts canViewFuel={canViewFuel} today={TODAY} warningDays={30} />)

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

/**
 * «Próximo vencimiento» deja de ser una fecha suelta: dice qué documento vence, en qué estado está y
 * cuánto falta, con la abreviatura expandida en `title` (regla A6). Tabla y tarjeta móvil conviven en el
 * DOM, así que lo que cuenta dos veces se busca con `getAllBy…`.
 */
describe("FleetTable · próximo vencimiento", () => {
  const vencida = { ...base, id: "v6", plate: "AA-0006", nextExpiryDate: "2026-11-02", nextExpiryDocumentType: "Revisión técnica" }
  const porVencer = { ...base, id: "v7", plate: "AA-0007", nextExpiryDate: "2026-11-14", nextExpiryDocumentType: "Permiso de circulación" }
  const vigente = { ...base, id: "v8", plate: "AA-0008", nextExpiryDate: "2027-09-30", nextExpiryDocumentType: "SOAP" }
  const sinFecha = { ...base, id: "v9", plate: "AA-0009" }

  it("lo vencido dice qué documento, el estado y hace cuántos días", () => {
    renderTable([vencida])

    const tarjeta = within(card("AA-0006"))
    expect(tarjeta.getByText("Vencido")).toBeInTheDocument()
    expect(tarjeta.getByText("Rev. técnica")).toHaveAttribute("title", "Revisión técnica")
    expect(tarjeta.getByText("venció hace 3 días")).toBeInTheDocument()
    // La misma celda en la tabla de escritorio.
    expect(screen.getAllByText("Rev. técnica")).toHaveLength(2)
  })

  it("por vencer cuenta los días dentro de la ventana y abrevia el permiso con su nombre completo", () => {
    renderTable([porVencer])

    const tarjeta = within(card("AA-0007"))
    expect(tarjeta.getByText("Por vencer")).toBeInTheDocument()
    expect(tarjeta.getByText("Permiso circ.")).toHaveAttribute("title", "Permiso de circulación")
    expect(tarjeta.getByText("vence en 9 días")).toBeInTheDocument()
  })

  it("vigente más allá de la ventana dice la fecha, no un conteo de días, y el SOAP lleva su significado", () => {
    renderTable([vigente])

    const tarjeta = within(card("AA-0008"))
    expect(tarjeta.getByText("Vigente")).toBeInTheDocument()
    expect(tarjeta.getByText("vence el 30-09-2027")).toBeInTheDocument()
    expect(tarjeta.getByText("SOAP")).toHaveAttribute("title", expect.stringMatching(/seguro obligatorio de accidentes personales/i))
  })

  it("sin ninguna fecha lo dice con texto apagado, sin una pastilla «Sin fecha» por equipo", () => {
    renderTable([sinFecha])

    expect(within(card("AA-0009")).getByText("Sin fecha registrada")).toBeInTheDocument()
    expect(within(card("AA-0009")).queryByText("Sin fecha")).toBeNull()
    expect(screen.getAllByText("Sin fecha registrada")).toHaveLength(2)
  })

  it("un tipo de documento sin abreviatura se escribe tal cual", () => {
    renderTable([{ ...vencida, id: "v10", plate: "AA-0010", nextExpiryDocumentType: "Padrón" }])

    expect(within(card("AA-0010")).getByText("Padrón")).toBeInTheDocument()
  })
})
