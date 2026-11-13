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
 * P-9: la tarjeta móvil de Flota no mostraba «Lectura (km u h)» (la tabla de escritorio sí). Las dos vistas viven en
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
  it("muestra «Lectura (km u h)» con la última lectura: el odómetro en km y, a falta de él, el horómetro en h", () => {
    renderTable([LIMPIA, HOROMETRO])

    expect(within(card("AA-0001")).getByText("Lectura (km u h)")).toBeInTheDocument()
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

    const dd = within(card("AA-0004")).getByText("Lectura (km u h)").closest("div")!
    expect(within(dd).getByText("—")).toBeInTheDocument()
    expect(within(card("AA-0004")).queryByText(/\d+ km|\d+ h$/)).toBeNull()
  })

  it("con la misma condición que la columna de la tabla: sin combustibles:view, o si ningún equipo tiene lectura, no hay «Lectura (km u h)»", () => {
    const { unmount } = renderTable([LIMPIA], false)
    expect(within(card("AA-0001")).queryByText("Lectura (km u h)")).toBeNull()
    unmount()

    renderTable([SIN_LECTURA, { ...SIN_LECTURA, id: "v5", plate: "AA-0005" }])
    expect(within(card("AA-0004")).queryByText("Lectura (km u h)")).toBeNull()
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

/**
 * F5/F3: el vehículo se abre desde un enlace real en la celda (no desde un `role="link"` sobre la fila) y
 * las columnas con unidades dicen «km u hora»; sin movimientos de combustible el gasto es «—», no «$0».
 */
describe("FleetTable · enlace, estado y columnas", () => {
  const conCodigo = { ...base, id: "v11", code: "KA-115", plate: "DZTH-66" }
  const sinCombustible = { ...base, id: "v12", plate: "AA-0012", totalLiters: 0, loadCount: 0, totalFuelAmount: 0 }

  it("la identidad del vehículo es un enlace a su ficha con el código; la patente va debajo con el tipo", () => {
    renderTable([conCodigo])

    const enlaces = screen.getAllByRole("link", { name: "Ver ficha de KA-115" })
    expect(enlaces.some((link) => link.getAttribute("href") === "/flota/v11")).toBe(true)
    expect(screen.getAllByText("Camión · DZTH-66").length).toBeGreaterThan(0)
  })

  it("ninguna fila se anuncia como enlace: el enlace es el de la celda", () => {
    renderTable([conCodigo])

    expect(screen.queryAllByRole("row").filter((row) => row.getAttribute("role") === "link")).toHaveLength(0)
    expect(document.querySelector('tr[role="link"]')).toBeNull()
  })

  it("el estado usa el vocabulario de flota", () => {
    renderTable([{ ...conCodigo, operationalStatus: "mantencion" }, { ...base, id: "v13", plate: "AA-0013", isActive: false }])

    expect(screen.getAllByText("En mantención").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Inactivo").length).toBeGreaterThan(0)
  })

  it("nombra las magnitudes con su unidad y no repite siglas que se leen como velocidad", () => {
    renderTable([LIMPIA])

    for (const header of ["Gasto combustible (12 m)", "Costo por km u hora", "Lectura (km u h)"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument()
    }
    expect(screen.queryByText(/Km\/Hr|km\/h$/)).toBeNull()
  })

  it("sin movimientos de combustible el gasto dice «—», no $0", () => {
    renderTable([sinCombustible])

    const fila = screen.getAllByRole("row").find((row) => within(row).queryByText("AA-0012"))!
    expect(within(fila).queryByText("$0")).toBeNull()
    expect(within(fila).getAllByText("—").length).toBeGreaterThan(0)
  })
})
