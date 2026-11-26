// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { bucketLabel } from "@/lib/indicators/period"
import { historyHref, parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { HistoryTable } from "./history-table"

const TODAY = "2026-11-25"
const HISTORY_PATH = "/mantencion/registros/historicos"
const CARDS_LABEL = "Trabajos de mantención como tarjetas"
const TABLE_HEADERS = ["Fecha", "Equipo", "Tipo", "Trabajo", "Lectura", "Días en taller", "Horas hombre", "Responsable", "Ficha"]

type Overrides = Partial<Omit<MaintenanceHistoryRow, "detail">> & { detail?: Partial<MaintenanceHistoryRow["detail"]> }

/** Un trabajo del historial con datos sintéticos; cada prueba cambia sólo lo que mira. */
function row({ detail, ...overrides }: Overrides = {}): MaintenanceHistoryRow {
  return {
    id: "h:1",
    source: "historial",
    reference: "",
    date: "2026-11-10",
    vehicleId: "veh-1",
    equipmentLabel: "EQ-01 · ABCD12",
    worksiteId: "ws-1",
    worksiteName: "Faena de prueba",
    actionType: "correctiva",
    laborHours: 4,
    workshopDays: 2,
    inWorkshop: false,
    external: false,
    ...overrides,
    detail: {
      description: "Cambio de bomba hidráulica",
      entryDate: "2026-11-10",
      exitDate: "2026-11-12",
      reading: "40.312 km",
      orderText: "29600",
      responsible: null,
      specialties: ["hidraulica"],
      contract: null,
      href: "/mantencion/registros/historicos/fuente-1",
      unlinkedEquipment: false,
      unlinkedWorksite: false,
      qualityNotes: null,
      ...detail,
    },
  }
}

/** Pinta la tabla con los parámetros de la URL dados; devuelve la tabla de escritorio y los parámetros ya leídos. */
function renderTable(rows: MaintenanceHistoryRow[], query: Record<string, string> = {}) {
  const params = parseHistoryParams(query, TODAY)
  render(<HistoryTable rows={rows} params={params} />)
  return { table: screen.getByRole("table"), params }
}

/** La fila de escritorio de un trabajo, por un texto que sólo ella tiene. */
function rowOf(table: HTMLElement, text: string): HTMLElement {
  return within(table).getByText(text).closest("tr") as HTMLElement
}

/** El encabezado de un grupo: la única fila de la tabla que ocupa todas las columnas. */
function groupRow(table: HTMLElement, label: string): HTMLElement {
  const found = Array.from(table.querySelectorAll("tr")).find((tr) => tr.querySelector("td[colspan]") && tr.textContent?.startsWith(label))
  if (!found) throw new Error(`No hay encabezado de grupo «${label}»`)
  return found as HTMLElement
}

/** La tarjeta móvil del trabajo cuyo equipo es `equipment` (los títulos de nivel 2 son los equipos). */
function cardOf(equipment: string): HTMLElement {
  const list = screen.getByRole("list", { name: CARDS_LABEL })
  return within(list).getByRole("heading", { level: 2, name: equipment }).closest("article") as HTMLElement
}

/** El valor de un campo de la tarjeta (la `dd` que sigue a la `dt` con esa etiqueta). */
function fieldOf(card: HTMLElement, label: string): HTMLElement {
  return within(card).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement
}

afterEach(cleanup)

describe("HistoryTable: una fila de escritorio y una tarjeta móvil por trabajo", () => {
  it("dibuja una fila de tabla y una tarjeta por cada trabajo de la página", () => {
    const { table } = renderTable([
      row({ id: "h:1", detail: { description: "Trabajo uno" } }),
      row({ id: "h:2", date: "2026-11-11", detail: { description: "Trabajo dos" } }),
    ])
    expect(within(table).getAllByRole("row")).toHaveLength(3)
    expect(screen.getAllByRole("article")).toHaveLength(2)
  })

  it("las columnas de la tabla van en el orden que la página promete", () => {
    const { table } = renderTable([row()])
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(TABLE_HEADERS)
  })

  it("la fila de escritorio trae fecha, origen, equipo con faena, tipo, trabajo, lectura, días, horas y responsable", () => {
    const { table } = renderTable([row({
      source: "ot",
      reference: "OT-0001",
      date: "2026-11-10",
      equipmentLabel: "EQ-01 · ABCD12",
      worksiteName: "Faena de prueba",
      actionType: "preventiva",
      laborHours: 3.5,
      workshopDays: 3,
      external: true,
      detail: { description: "Cambio de aceite", reading: "40.312 km", responsible: "Taller de prueba" },
    })])
    const tr = rowOf(table, "Cambio de aceite")
    expect(within(tr).getByText("10-11-2026")).toBeDefined()
    expect(within(tr).getByText("Orden de trabajo")).toBeDefined()
    expect(within(tr).getByText("EQ-01 · ABCD12")).toBeDefined()
    expect(within(tr).getByText("Faena de prueba")).toBeDefined()
    expect(within(tr).getByText("Preventiva")).toBeDefined()
    expect(within(tr).getByText("40.312 km")).toBeDefined()
    expect(within(tr).getByText("3 días")).toBeDefined()
    expect(within(tr).getByText("3,5 h")).toBeDefined()
    expect(within(tr).getByText("Externo · Taller de prueba")).toBeDefined()
  })

  it("un trabajo sin faena lo dice con «Sin faena» en la fila", () => {
    const { table } = renderTable([row({ worksiteId: null, worksiteName: null })])
    expect(within(rowOf(table, "Cambio de bomba hidráulica")).getByText("Sin faena")).toBeDefined()
  })

  it("lo que el trabajo no informa sale como «—» en su columna, sin inventar un valor", () => {
    const { table } = renderTable([row({ laborHours: null, workshopDays: null, inWorkshop: false, external: null, detail: { reading: null, description: "" } })])
    const cells = Array.from(rowOf(table, "No informado").querySelectorAll("td"))
    expect(cells[3]!.textContent).toBe("No informado")
    expect(cells[4]!.textContent).toBe("—")
    expect(cells[5]!.textContent).toBe("—")
    expect(cells[6]!.textContent).toBe("—")
    expect(cells[7]!.textContent).toBe("—")
  })

  it("un trabajo que sigue en taller lo dice en la columna de días", () => {
    const { table } = renderTable([
      row({ id: "h:1", workshopDays: 3, inWorkshop: true, detail: { description: "Con días" } }),
      row({ id: "h:2", workshopDays: null, inWorkshop: true, detail: { description: "Sin días" } }),
    ])
    expect(within(rowOf(table, "Con días")).getByText("3 días · sigue en taller")).toBeDefined()
    expect(within(rowOf(table, "Sin días")).getByText("En taller")).toBeDefined()
  })

  it("la tarjeta móvil lleva el equipo como título de nivel 2 (la lista cuelga del h1) y los datos como campos", () => {
    renderTable([row({ actionType: "correctiva", laborHours: 3.5, workshopDays: 3, external: true, detail: { reading: "40.312 km", responsible: "Taller de prueba" } })])
    const card = cardOf("EQ-01 · ABCD12")
    expect(within(card).getByText("Correctiva")).toBeDefined()
    expect(fieldOf(card, "Lectura").textContent).toBe("40.312 km")
    expect(fieldOf(card, "Días en taller").textContent).toBe("3 días")
    expect(fieldOf(card, "Horas hombre").textContent).toBe("3,5 h")
    expect(fieldOf(card, "Responsable").textContent).toBe("Externo · Taller de prueba")
    expect(fieldOf(card, "Trabajo").textContent).toBe("Cambio de bomba hidráulica")
  })
})

describe("HistoryTable: avisos de revisión", () => {
  it("un trabajo sin equipo ni faena vinculados lo avisa en la fila y en la tarjeta", () => {
    const { table } = renderTable([row({
      vehicleId: null,
      equipmentLabel: "Texto del formulario",
      worksiteId: null,
      worksiteName: null,
      detail: { unlinkedEquipment: true, unlinkedWorksite: true },
    })])
    const tr = rowOf(table, "Cambio de bomba hidráulica")
    expect(within(tr).getByText("Equipo sin identificar")).toBeDefined()
    expect(within(tr).getByText("Faena sin identificar")).toBeDefined()
    const revisar = fieldOf(cardOf("Texto del formulario"), "Revisar")
    expect(within(revisar).getByText("Equipo sin identificar")).toBeDefined()
    expect(within(revisar).getByText("Faena sin identificar")).toBeDefined()
  })

  it("la observación de calidad sale con su texto, y el texto completo queda en el atributo title", () => {
    const { table } = renderTable([row({ detail: { qualityNotes: "Falta la firma del jefe" } })])
    const note = within(rowOf(table, "Cambio de bomba hidráulica")).getByText("Observación de calidad: Falta la firma del jefe")
    expect(note).toHaveAttribute("title", "Falta la firma del jefe")
  })

  it("un trabajo con equipo, faena y datos completos no lleva ningún aviso de revisión", () => {
    const { table } = renderTable([row()])
    expect(within(table).queryByText("Equipo sin identificar")).toBeNull()
    expect(within(table).queryByText("Faena sin identificar")).toBeNull()
    expect(within(table).queryByText(/Observación de calidad/)).toBeNull()
    expect(within(cardOf("EQ-01 · ABCD12")).queryByText("Revisar", { selector: "dt" })).toBeNull()
  })
})

describe("HistoryTable: cabeceras ordenables", () => {
  it("las cabeceras ordenables son enlaces con el sentido por defecto: la fecha baja y el resto sube", () => {
    const { table, params } = renderTable([row()])
    const header = (name: string) => within(table).getByRole("columnheader", { name })

    expect(header("Fecha")).toHaveAttribute("aria-sort", "descending")
    expect(within(header("Fecha")).getByRole("link").getAttribute("href")).toBe(historyHref(params, { sort: "fecha", dir: "asc" }))
    expect(within(header("Fecha")).getByRole("link").getAttribute("href")).toBe(`${HISTORY_PATH}?dir=asc`)

    for (const [name, sort, href] of [
      ["Equipo", "equipo", "?orden=equipo"],
      ["Tipo", "tipo", "?orden=tipo"],
      ["Días en taller", "dias", "?orden=dias"],
      ["Horas hombre", "horas", "?orden=horas"],
    ] as const) {
      expect(header(name)).toHaveAttribute("aria-sort", "none")
      expect(within(header(name)).getByRole("link").getAttribute("href")).toBe(historyHref(params, { sort, dir: "asc" }))
      expect(within(header(name)).getByRole("link").getAttribute("href")).toBe(`${HISTORY_PATH}${href}`)
    }
  })

  it("Trabajo, lectura y responsable no se ordenan: su cabecera no es un enlace", () => {
    const { table } = renderTable([row()])
    for (const name of ["Trabajo", "Lectura", "Responsable"]) {
      expect(within(table).getByRole("columnheader", { name })).not.toHaveAttribute("aria-sort")
      expect(within(table).getByRole("columnheader", { name }).querySelector("a")).toBeNull()
    }
  })

  it("la columna activa dice su sentido en aria-sort y su enlace invierte el orden", () => {
    const { table } = renderTable([row()], { orden: "equipo" })
    const equipo = within(table).getByRole("columnheader", { name: "Equipo" })
    expect(equipo).toHaveAttribute("aria-sort", "ascending")
    expect(within(equipo).getByRole("link").getAttribute("href")).toBe(`${HISTORY_PATH}?orden=equipo&dir=desc`)
  })

  it("una columna descendente se invierte a ascendente, y la fecha vuelve a bajar al pulsarla desde otra columna", () => {
    const { table } = renderTable([row()], { orden: "dias", dir: "desc" })
    const dias = within(table).getByRole("columnheader", { name: "Días en taller" })
    expect(dias).toHaveAttribute("aria-sort", "descending")
    expect(within(dias).getByRole("link").getAttribute("href")).toBe(`${HISTORY_PATH}?orden=dias`)
    expect(within(table).getByRole("columnheader", { name: "Fecha" })).toHaveAttribute("aria-sort", "none")
    expect(within(within(table).getByRole("columnheader", { name: "Fecha" })).getByRole("link").getAttribute("href")).toBe(HISTORY_PATH)
  })

  it("con agrupación activa las cabeceras son texto: no ordenan, porque el orden lo manda el grupo", () => {
    const { table } = renderTable([row()], { agrupar: "mes" })
    for (const name of ["Fecha", "Equipo", "Tipo", "Días en taller", "Horas hombre"]) {
      const header = within(table).getByRole("columnheader", { name })
      expect(header).not.toHaveAttribute("aria-sort")
      expect(header.querySelector("a")).toBeNull()
    }
  })
})

describe("HistoryTable: agrupación", () => {
  const BY_EQUIPMENT = [
    row({ id: "h:1", date: "2026-11-10", detail: { description: "Trabajo uno" } }),
    row({ id: "h:2", date: "2026-10-03", detail: { description: "Trabajo dos" } }),
    row({ id: "h:3", date: "2026-11-05", vehicleId: "veh-2", equipmentLabel: "EQ-02 · EFGH34", detail: { description: "Trabajo tres" } }),
  ]

  it("agrupado por equipo, el encabezado de cada equipo enlaza a su historial y cuenta sus trabajos de la página", () => {
    const { table, params } = renderTable(BY_EQUIPMENT, { agrupar: "equipo" })
    expect(within(table).getByRole("link", { name: "EQ-01 · ABCD12" }).getAttribute("href")).toBe(historyHref(params, { vehicleId: "veh-1", group: null }))
    expect(within(table).getByRole("link", { name: "EQ-01 · ABCD12" }).getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1`)
    expect(within(groupRow(table, "EQ-01 · ABCD12")).getByText("2 trabajos en esta página")).toBeDefined()
    expect(within(groupRow(table, "EQ-02 · EFGH34")).getByText("1 trabajo en esta página")).toBeDefined()
  })

  it("el grupo «sin equipo» dice «Equipo sin identificar» como texto, no como enlace", () => {
    const { table } = renderTable([
      ...BY_EQUIPMENT,
      row({ id: "h:4", vehicleId: null, equipmentLabel: "Texto libre", date: "2026-11-01", detail: { description: "Trabajo sin equipo", unlinkedEquipment: true } }),
    ], { agrupar: "equipo" })
    expect(within(table).queryByRole("link", { name: "Equipo sin identificar" })).toBeNull()
    expect(within(groupRow(table, "Equipo sin identificar")).getByText("Equipo sin identificar")).toBeDefined()
    expect(within(groupRow(table, "Equipo sin identificar")).getByText("1 trabajo en esta página")).toBeDefined()
  })

  it("agrupado por mes, el encabezado dice el mes y su conteo, sin enlace; la tarjeta móvil lo repite", () => {
    const { table } = renderTable([
      row({ id: "h:1", date: "2026-11-10", detail: { description: "Trabajo uno" } }),
      row({ id: "h:2", date: "2026-11-03", detail: { description: "Trabajo dos" } }),
      row({ id: "h:3", date: "2026-10-03", detail: { description: "Trabajo tres" } }),
    ], { agrupar: "mes" })
    const nov = bucketLabel("2026-11", "month")
    const oct = bucketLabel("2026-10", "month")

    expect(within(groupRow(table, nov)).getByText("2 trabajos en esta página")).toBeDefined()
    expect(within(groupRow(table, nov)).queryByRole("link")).toBeNull()
    expect(within(groupRow(table, oct)).getByText("1 trabajo en esta página")).toBeDefined()

    const headings = within(screen.getByRole("list", { name: CARDS_LABEL })).getAllByRole("listitem")
      .filter((item) => !item.querySelector("article"))
      .map((item) => item.textContent)
    expect(headings).toEqual([`${nov} · 2`, `${oct} · 1`])
  })

  it("el enlace «Abrir» de cada fila va a la ficha de origen y su nombre accesible dice equipo y fecha, también en la tarjeta", () => {
    const name = "Abrir la ficha del trabajo de EQ-01 · ABCD12 del 10-11-2026"
    const { table } = renderTable([row({ detail: { href: "/mantencion/registros/historicos/ot-1" } })])
    expect(within(table).getByRole("link", { name }).getAttribute("href")).toBe("/mantencion/registros/historicos/ot-1")
    expect(within(cardOf("EQ-01 · ABCD12")).getByRole("link", { name }).getAttribute("href")).toBe("/mantencion/registros/historicos/ot-1")
  })
})
