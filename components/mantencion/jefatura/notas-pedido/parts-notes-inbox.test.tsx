// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteRow } from "./notas-pedido-fixtures"
import { ageText, buildPartsNotesTabs, lineProgress, parsePartsNotesQuery, pendingLinesText } from "./parts-notes-format"

// jsdom no implementa `scrollIntoView`, que Radix Select llama al abrir la lista.
Element.prototype.scrollIntoView = function scrollIntoView() {}

// La bandeja lee la URL con `StageTabs` y `DataTable`; el filtro de faena escribe en ella.
const navigation = vi.hoisted(() => ({ replace: vi.fn(), search: "estado=pendientes" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/mantencion/notas-pedido",
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const { PartsNotesTable } = await import("./parts-notes-table")
const { PartsNotesFilters } = await import("./parts-notes-filters")
const { StageTabs } = await import("@/components/ui/stage-tabs")

beforeEach(() => { navigation.replace.mockClear(); navigation.search = "estado=pendientes" })
afterEach(cleanup)

describe("pestañas y filtros de la bandeja", () => {
  it("sin estado rige «Pendientes» y la URL no marcada pide redirigir; «Por conciliar» sólo con manage", () => {
    expect(parsePartsNotesQuery({}, true)).toMatchObject({ tab: "pendientes", explicitTab: false, page: 1 })
    expect(parsePartsNotesQuery({ estado: "cerradas", faena: "ws-2", q: " KA-135 ", pagina: "3" }, false))
      .toEqual({ tab: "cerradas", explicitTab: true, worksiteId: "ws-2", q: "KA-135", page: 3 })
    expect(parsePartsNotesQuery({ estado: "por_conciliar" }, true)).toMatchObject({ tab: "por_conciliar", explicitTab: true })
    // Sin permiso para conciliar, la pestaña no existe: se vuelve a «Pendientes».
    expect(parsePartsNotesQuery({ estado: "por_conciliar" }, false)).toMatchObject({ tab: "pendientes", explicitTab: false })
    expect(parsePartsNotesQuery({ estado: "inventada", pagina: "-2" }, true)).toMatchObject({ tab: "pendientes", explicitTab: false, page: 1 })
  })

  it("Pendientes · En gestión · Cerradas con su conteo; «Por conciliar» sólo cuando se ofrece", () => {
    const counts = { pendientes: 4, en_gestion: 2, cerradas: 17 }
    expect(buildPartsNotesTabs(counts, null).map((tab) => [tab.value, tab.label, tab.count])).toEqual([
      ["pendientes", "Pendientes", 4], ["en_gestion", "En gestión", 2], ["cerradas", "Cerradas", 17],
    ])
    const withConciliation = buildPartsNotesTabs(counts, 3)
    expect(withConciliation.map((tab) => tab.label)).toEqual(["Pendientes", "En gestión", "Cerradas", "Por conciliar"])
    expect(withConciliation[3]).toMatchObject({ value: "por_conciliar", count: 3, countTone: "signal" })
    // El naranja es de lo pendiente: «Cerradas» no lo lleva.
    expect(withConciliation[2]!.countTone).toBeUndefined()
  })

  it("las pestañas se pintan como enlaces con el conteo en el nombre y la activa marcada", () => {
    render(<StageTabs tabs={buildPartsNotesTabs({ pendientes: 4, en_gestion: 2, cerradas: 17 }, 3)} ariaLabel="Estado de las notas de pedido" pageParam="pagina" />)
    const nav = within(screen.getByRole("navigation", { name: "Estado de las notas de pedido" }))
    expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual(["Pendientes 4", "En gestión 2", "Cerradas 17", "Por conciliar 3"])
    expect(nav.getByRole("link", { name: /^Pendientes\s*4$/ }).getAttribute("aria-current")).toBe("page")
    expect(nav.getByRole("link", { name: /^Cerradas\s*17$/ }).getAttribute("href")).toBe("/mantencion/notas-pedido?estado=cerradas")
  })

  it("el filtro de faena cambia la URL sin guardar la página y se ofrece sólo con más de una faena", () => {
    navigation.search = "estado=pendientes&pagina=2"
    const worksites = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }]
    const { rerender } = render(<PartsNotesFilters worksites={worksites} allWorksitesLabel="Todas las faenas" />)
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Santa Fe" }))
    expect(navigation.replace).toHaveBeenCalledTimes(1)
    const [url, options] = navigation.replace.mock.calls[0]! as [string, { scroll: boolean }]
    expect(new URLSearchParams(url.split("?")[1])).toEqual(new URLSearchParams("estado=pendientes&faena=ws-2"))
    expect(options).toEqual({ scroll: false })

    rerender(<PartsNotesFilters worksites={[worksites[0]!]} allWorksitesLabel="Todas las faenas" />)
    expect(screen.queryByRole("combobox", { name: "Filtrar por faena" })).toBeNull()
  })
})

describe("textos de la fila", () => {
  it("«2 de 3» líneas pendientes y antigüedad en días civiles", () => {
    expect(pendingLinesText(2, 3)).toBe("2 de 3")
    const now = new Date("2026-11-26T15:00:00.000Z")
    expect(ageText("2026-11-26T09:00:00.000Z", now)).toBe("Hoy")
    expect(ageText("2026-11-25T09:00:00.000Z", now)).toBe("Ayer")
    expect(ageText("2026-11-21T09:00:00.000Z", now)).toBe("Hace 5 días")
  })

  it("la cadena de una línea dice dónde está: Pedido → En compra → Llegó 2/2 → Usado 1/2", () => {
    const base = { quantity: 2, arrived: 0, used: 0 }
    const text = (line: Parameters<typeof lineProgress>[0]) => lineProgress(line)!.map((step) => step.label).join(" → ")
    expect(text({ ...base, stage: "pedido" })).toBe("Pedido → En compra → Llegó → Usado")
    expect(text({ ...base, stage: "en_bodega", arrived: 2, used: 1 })).toBe("Pedido → En compra → Llegó 2/2 → Usado 1/2")
    expect(lineProgress({ ...base, stage: "en_bodega", arrived: 2, used: 1 })!.map((step) => step.state)).toEqual(["done", "done", "done", "current"])
    expect(lineProgress({ ...base, stage: "en_compra" })!.map((step) => step.state)).toEqual(["done", "current", "todo", "todo"])
    expect(lineProgress({ ...base, stage: "en_bodega", arrived: 2, used: 2 })!.every((step) => step.state === "done")).toBe(true)
    // Una línea rechazada no avanza.
    expect(lineProgress({ ...base, stage: "rechazado" })).toBeNull()
  })
})

describe("PartsNotesTable", () => {
  const rows = [
    noteRow({ equipmentStopped: true }),
    noteRow({ id: "n2", code: "NP-2026-0002", status: "cerrada", equipmentStopped: true, pendingLines: 0, totalLines: 1, workOrderId: "ot-2", workOrderFolio: "OT-BIO-0002" }),
    noteRow({ id: "n3", code: "NP-2026-0003", status: "anulada", pendingLines: 0, totalLines: 2 }),
  ]
  const table = () => within(screen.getByRole("table", { name: "Notas de pedido" }))
  const cards = () => screen.getAllByRole("article")

  it("columnas: nota, equipo y OT, faena, pedida por, líneas pendientes y antigüedad", () => {
    render(<PartsNotesTable rows={rows} />)
    expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Nota", "Equipo y OT", "Faena", "Pedida por", "Líneas pendientes", "Antigüedad",
    ])
    const first = table().getAllByRole("row")[1]!
    expect(within(first).getByRole("link", { name: "NP-2026-0001" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n1")
    expect(within(first).getByRole("link", { name: "Ver la OT OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(first.textContent).toContain("KA-135")
    expect(first.textContent).toContain("RBYD-98")
    expect(first.textContent).toContain("Biodiversa")
    expect(first.textContent).toContain("Javier Roa")
    expect(first.textContent).toContain("2 de 3")
  })

  it("«Equipo detenido» sólo en una nota que sigue pendiente; una cerrada no lleva el naranja", () => {
    render(<PartsNotesTable rows={rows} />)
    const bodyRows = table().getAllByRole("row").slice(1)
    expect(within(bodyRows[0]!).getByText("Equipo detenido")).toBeTruthy()
    expect(within(bodyRows[1]!).queryByText("Equipo detenido")).toBeNull()
    // La anulada se distingue en texto dentro de «Cerradas».
    expect(within(bodyRows[2]!).getByText("Anulada")).toBeTruthy()
  })

  it("en el móvil cada nota es una tarjeta con sus datos y un enlace de 44 px a la nota", () => {
    render(<PartsNotesTable rows={rows} />)
    expect(cards()).toHaveLength(3)
    const first = within(cards()[0]!)
    expect(first.getByText("NP-2026-0001")).toBeTruthy()
    expect(first.getByText("Equipo detenido")).toBeTruthy()
    expect(first.getByText("2 de 3")).toBeTruthy()
    expect(first.getByText("Javier Roa")).toBeTruthy()
    expect(first.getByRole("link", { name: /OT-BIO-0001/ }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(first.getByRole("link", { name: "Ver la nota NP-2026-0001" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n1")
    expect(within(cards()[1]!).queryByText("Equipo detenido")).toBeNull()
  })
})
