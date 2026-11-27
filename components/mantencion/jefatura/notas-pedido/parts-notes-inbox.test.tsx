// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteRow } from "./notas-pedido-fixtures"
import {
  ageText, buildPartsNotesTabs, chargesText, exportParamsOf, lineProgress, NOTE_FILTER_PARAMS, parsePartsNotesQuery, parsePartsNoteFilters, pendingLinesText, STATUSES_BY_TAB,
} from "./parts-notes-format"

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
    expect(parsePartsNotesQuery({ estado: "cerradas" }, false)).not.toHaveProperty("status")
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

  it("los filtros de la URL: estado exacto, urgencia, fechas, solicitante, equipo y repuesto; un valor mal formado se ignora", () => {
    expect(parsePartsNoteFilters({
      faena: "ws-1", situacion: "en_espera", urgencia: "urgente", desde: "2026-11-01", hasta: "2026-11-27",
      solicitante: " Javier ", equipo: "KA-135", articulo: "filtro", q: "NP-1",
    })).toEqual({
      worksiteId: "ws-1", status: "en_espera", urgent: true, from: "2026-11-01", to: "2026-11-27",
      requester: "Javier", equipment: "KA-135", article: "filtro", q: "NP-1",
    })
    expect(parsePartsNoteFilters({ urgencia: "normal" })).toEqual({ urgent: false })
    // Estado que no existe, urgencia inventada, fecha con otro formato o inexistente: no llegan a la consulta.
    expect(parsePartsNoteFilters({ situacion: "inventado", urgencia: "tal", desde: "27-11-2026", hasta: "2026-02-30" })).toEqual({})
    // Un arreglo (parámetro repetido) toma el primero.
    expect(parsePartsNoteFilters({ equipo: ["KA-135", "KA-136"] })).toEqual({ equipment: "KA-135" })
  })

  it("cada estado exacto vive en una sola pestaña y entre las tres están los nueve", () => {
    const all = Object.values(STATUSES_BY_TAB).flat()
    expect(all).toHaveLength(9)
    expect(new Set(all).size).toBe(9)
    expect(STATUSES_BY_TAB.en_gestion).toEqual(["en_compra", "recibida_parcial"])
  })

  it("la exportación lleva la pestaña y los filtros de la URL (y nada más); en «Por conciliar» no lleva pestaña", () => {
    expect(exportParamsOf({ estado: "pendientes", faena: "ws-2", situacion: "aceptada", pagina: "3", otro: "x" }, "pendientes"))
      .toMatchObject({ estado: "pendientes", faena: "ws-2", situacion: "aceptada" })
    const params = exportParamsOf({ pagina: "3", otro: "x" }, "cerradas")
    expect(Object.keys(params)).toEqual(["estado", ...NOTE_FILTER_PARAMS])
    expect(exportParamsOf({}, "por_conciliar")).not.toHaveProperty("estado")
  })

  it("el cargo de una nota sin OT en una celda: los dos primeros y cuántos más", () => {
    expect(chargesText(["KA-135"])).toBe("KA-135")
    expect(chargesText(["KA-135", "Taller"])).toBe("KA-135, Taller")
    expect(chargesText(["KA-135", "Taller", "CR43-51-52", "GR-11"])).toBe("KA-135, Taller +2")
    expect(chargesText([])).toBe("")
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

  it("la barra ofrece cinco filtros primarios y deja estado, solicitante, equipo y repuesto en «Más filtros»", () => {
    render(<PartsNotesFilters worksites={[{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }]} allWorksitesLabel="Todas las faenas" />)
    expect(screen.getByRole("searchbox", { name: /Buscar notas de pedido/ })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Filtrar por faena" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Filtrar por urgencia" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Creada desde/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Creada hasta/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Más filtros" })).toBeTruthy()
    // Los de «Más filtros» no están a la vista hasta abrir la hoja.
    expect(screen.queryByRole("combobox", { name: "Filtrar por estado" })).toBeNull()
  })

  it("«Más filtros» cuenta los activos, ofrece sólo los estados de la pestaña y escribe el estado exacto en la URL", () => {
    navigation.search = "estado=en_gestion&situacion=en_compra&solicitante=Javier&pagina=2"
    render(<PartsNotesFilters worksites={[]} allWorksitesLabel="Todas las faenas" tab="en_gestion" />)
    expect(screen.getByRole("button", { name: "Más filtros (2 activos)" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Más filtros/ }))
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Todos los estados de la pestaña", "En compra", "Recibida parcial"])
    fireEvent.click(screen.getByRole("option", { name: "Recibida parcial" }))
    const [url] = navigation.replace.mock.calls.at(-1)! as [string]
    expect(new URLSearchParams(url.split("?")[1])).toEqual(new URLSearchParams("estado=en_gestion&situacion=recibida_parcial&solicitante=Javier"))
  })

  it("cada filtro activo es una pastilla removible, y «Limpiar filtros» los quita todos sin tocar la pestaña", () => {
    navigation.search = "estado=pendientes&urgencia=urgente&desde=2026-11-01&situacion=aceptada&equipo=KA-135&q=NP-1"
    render(<PartsNotesFilters worksites={[]} allWorksitesLabel="Todas las faenas" />)
    for (const text of ["Urgencia:", "Creada desde:", "Estado:", "Equipo:", "Búsqueda:"]) expect(screen.getByText(text)).toBeTruthy()
    // El valor de cada pastilla (los del selector de urgencia también dicen «Urgentes»: se mira el título de la pastilla).
    expect(screen.getByTitle("Urgentes")).toBeTruthy()
    expect(screen.getByTitle("Aceptada")).toBeTruthy()
    expect(screen.getByTitle("01-11-2026")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    const [url] = navigation.replace.mock.calls.at(-1)! as [string]
    expect(new URLSearchParams(url.split("?")[1])).toEqual(new URLSearchParams("estado=pendientes"))
  })

  it("en «Por conciliar» sólo se filtra por faena: ni búsqueda ni urgencia ni fechas", () => {
    navigation.search = "estado=por_conciliar"
    const worksites = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }]
    render(<PartsNotesFilters worksites={worksites} allWorksitesLabel="Todas las faenas" tab="por_conciliar" />)
    expect(screen.getByRole("combobox", { name: "Filtrar por faena" })).toBeTruthy()
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Filtrar por urgencia" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Más filtros/ })).toBeNull()
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

  it("columnas: nota, equipo y OT, faena, pedida por, estado, desde cuándo está en él y líneas pendientes", () => {
    render(<PartsNotesTable rows={rows} />)
    expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Nota", "Equipo y OT", "Faena", "Pedida por", "Estado", "En este estado", "Líneas pendientes",
    ])
    const first = table().getAllByRole("row")[1]!
    expect(within(first).getByRole("link", { name: "NP-2026-0001" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n1")
    expect(within(first).getByRole("link", { name: "Ver la OT OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(first.textContent).toContain("KA-135")
    expect(first.textContent).toContain("RBYD-98")
    expect(first.textContent).toContain("Biodiversa")
    expect(first.textContent).toContain("Javier Roa")
    expect(first.textContent).toContain("2 de 3")
    expect(within(first).getByText("Enviada")).toBeTruthy()
  })

  it("«En este estado» cuenta desde el último evento (statusSince), no desde la creación; el título dice las dos fechas", () => {
    const now = Date.now()
    const day = 86_400_000
    render(<PartsNotesTable rows={[noteRow({ createdAt: new Date(now - 30 * day).toISOString(), statusSince: new Date(now - 2 * day).toISOString() })]} />)
    const cell = within(table().getAllByRole("row")[1]!).getByText("Hace 2 días")
    expect(cell.getAttribute("title")).toMatch(/En este estado desde el .* Creada el /)
  })

  it("una nota sin OT dice «Sin OT» y el cargo de sus líneas, sin enlace a una OT que no existe", () => {
    render(<PartsNotesTable rows={[noteRow({ id: "n9", code: "NP-2026-0009", workOrderId: null, workOrderFolio: null, equipmentCode: "", equipmentPlate: "", charges: ["KA-135", "Taller", "CR43-51-52"], externalRef: "CHOME-9" })]} />)
    const row = within(table().getAllByRole("row")[1]!)
    expect(row.getByText("Sin OT")).toBeTruthy()
    expect(row.getByText("Cargo: KA-135, Taller +1")).toBeTruthy()
    expect(row.getByText("CHOME-9")).toBeTruthy()
    expect(row.queryByRole("link", { name: /Ver la OT/ })).toBeNull()
    expect(row.getByRole("link", { name: "NP-2026-0009" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n9")
    // También en la tarjeta del móvil.
    const card = within(cards()[0]!)
    expect(card.getByText("Sin OT")).toBeTruthy()
    expect(card.queryByRole("link", { name: /Ver la OT/ })).toBeNull()
  })

  it("«Urgente» sólo en una nota pendiente; si además el equipo está detenido, una sola marca", () => {
    render(<PartsNotesTable rows={[
      noteRow({ id: "a", code: "NP-A", urgent: true }),
      noteRow({ id: "b", code: "NP-B", urgent: true, equipmentStopped: true }),
      noteRow({ id: "c", code: "NP-C", urgent: true, status: "cerrada", pendingLines: 0 }),
    ]} />)
    const bodyRows = table().getAllByRole("row").slice(1)
    expect(within(bodyRows[0]!).getByText("Urgente")).toBeTruthy()
    expect(within(bodyRows[1]!).getByText("Equipo detenido")).toBeTruthy()
    expect(within(bodyRows[1]!).queryByText("Urgente")).toBeNull()
    expect(within(bodyRows[2]!).queryByText("Urgente")).toBeNull()
  })

  it("los nueve estados se dicen en español con su insignia, nunca el valor crudo", () => {
    const statuses = ["enviada", "aceptada", "en_espera", "en_gestion", "en_compra", "recibida_parcial", "cerrada", "rechazada", "anulada"] as const
    render(<PartsNotesTable rows={statuses.map((status, index) => noteRow({ id: `n${index}`, code: `NP-${index}`, status }))} />)
    const labels = table().getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[4]!.textContent)
    expect(labels).toEqual(["Enviada", "Aceptada", "En espera", "En gestión", "En compra", "Recibida parcial", "Cerrada", "Rechazada", "Anulada"])
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
