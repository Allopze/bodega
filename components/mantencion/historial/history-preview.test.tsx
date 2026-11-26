// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { HistoryTable } from "./history-table"

const TODAY = "2026-11-25"
const CARDS_LABEL = "Trabajos de mantención como tarjetas"
/** El nombre del botón de la tarjeta móvil: sólo dice qué trabajo abre, el texto ya lo dice la tarjeta. */
const CARD_PREVIEW_NAME = "Vista previa del trabajo de EQ-01 · ABCD12 del 10-11-2026"

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

/** Un trabajo con todos los datos que la vista previa puede mostrar. */
function fullRow(): MaintenanceHistoryRow {
  return row({
    source: "ot",
    reference: "OT-0001",
    actionType: "correctiva",
    laborHours: 3.5,
    workshopDays: 3,
    external: true,
    detail: {
      entryDate: "2026-11-10",
      exitDate: "2026-11-13",
      responsible: "Taller de prueba",
      specialties: ["mecanica", "hidraulica"],
      orderText: "29600",
      contract: "CT-01",
      href: "/mantencion/registros/historicos/ot-1",
      qualityNotes: "Falta la firma del jefe",
    },
  })
}

function renderTable(rows: MaintenanceHistoryRow[]) {
  render(<HistoryTable rows={rows} params={parseHistoryParams({}, TODAY)} />)
  return { table: screen.getByRole("table") }
}

/** La vista previa abierta: el diálogo se nombra con el equipo. */
function openFromTable(table: HTMLElement, description: string): HTMLElement {
  fireEvent.click(within(table).getByRole("button", { name: new RegExp(description) }))
  return screen.getByRole("dialog", { name: "EQ-01 · ABCD12" })
}

/** El valor de un dato de la vista previa: la `dd` que sigue a su `dt`; `null` si el dato no aparece. */
function fact(dialog: HTMLElement, label: string): string | null {
  const dt = within(dialog).queryByText(label, { selector: "dt" })
  return dt?.nextElementSibling?.textContent ?? null
}

afterEach(cleanup)

describe("botones de vista previa: nombre accesible", () => {
  it("en la tabla, el nombre del botón contiene el trabajo que muestra, para que quien habla lo encuentre por su texto", () => {
    const { table } = renderTable([row()])
    const button = within(table).getByRole("button", { name: /Cambio de bomba hidráulica/ })
    expect(button.getAttribute("aria-label")).toBe("Cambio de bomba hidráulica. Vista previa del trabajo de EQ-01 · ABCD12 del 10-11-2026")
    expect(button.getAttribute("aria-label")).toContain("Cambio de bomba hidráulica")
  })

  it("sin descripción, el botón de la tabla nombra «No informado», que es lo que muestra", () => {
    const { table } = renderTable([row({ detail: { description: "" } })])
    const button = within(table).getByRole("button", { name: /No informado/ })
    expect(button.textContent).toBe("No informado")
    expect(button.getAttribute("aria-label")).toBe("No informado. Vista previa del trabajo de EQ-01 · ABCD12 del 10-11-2026")
  })

  it("en la tarjeta móvil, el botón sólo nombra «Vista previa del trabajo de…» y no repite el texto del trabajo", () => {
    renderTable([row()])
    const list = screen.getByRole("list", { name: CARDS_LABEL })
    const button = within(list).getByRole("button", { name: CARD_PREVIEW_NAME })
    expect(button.textContent).toBe("Vista previa")
    expect(button.getAttribute("aria-label")).toBe(CARD_PREVIEW_NAME)
    expect(button.getAttribute("aria-label")).not.toContain("Cambio de bomba")
  })
})

describe("vista previa del trabajo", () => {
  it("muestra el equipo, la fecha con su origen y referencia, el tipo, el trabajo y la faena", () => {
    const { table } = renderTable([fullRow()])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(within(dialog).getByRole("heading", { name: "EQ-01 · ABCD12" })).toBeDefined()
    expect(within(dialog).getByText("10-11-2026 · Orden de trabajo OT-0001")).toBeDefined()
    expect(within(dialog).getByText("Correctiva")).toBeDefined()
    expect(within(dialog).getByText("Cambio de bomba hidráulica", { selector: "p" })).toBeDefined()
    expect(fact(dialog, "Faena")).toBe("Faena de prueba")
  })

  it("muestra lectura, ingreso y salida de taller, días, horas, responsable y especialidades con su nombre", () => {
    const { table } = renderTable([fullRow()])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(fact(dialog, "Lectura del equipo")).toBe("40.312 km")
    expect(fact(dialog, "Ingreso a taller")).toBe("10-11-2026")
    expect(fact(dialog, "Salida de taller")).toBe("13-11-2026")
    expect(fact(dialog, "Días en taller")).toBe("3 días")
    expect(fact(dialog, "Horas hombre")).toBe("3,5 h")
    expect(fact(dialog, "Responsable")).toBe("Externo · Taller de prueba")
    expect(fact(dialog, "Especialidades")).toBe("Mecánica, Hidráulica")
  })

  it("el nº de orden y el contrato aparecen sólo cuando el trabajo los trae", () => {
    const { table } = renderTable([fullRow()])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(fact(dialog, "Nº de orden")).toBe("29600")
    expect(fact(dialog, "Contrato")).toBe("CT-01")
  })

  it("sin nº de orden ni contrato, esas dos filas no aparecen en la vista previa", () => {
    const { table } = renderTable([row({ detail: { orderText: null, contract: null } })])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(fact(dialog, "Nº de orden")).toBeNull()
    expect(fact(dialog, "Contrato")).toBeNull()
  })

  it("sin fechas de taller ni especialidades, dice «—» en vez de dejar el dato en blanco", () => {
    const { table } = renderTable([row({ detail: { entryDate: null, exitDate: null, specialties: [] } })])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(fact(dialog, "Ingreso a taller")).toBe("—")
    expect(fact(dialog, "Salida de taller")).toBe("—")
    expect(fact(dialog, "Especialidades")).toBe("—")
  })

  it("la observación de calidad sale en el panel con su texto", () => {
    const { table } = renderTable([fullRow()])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(within(dialog).getByText("Observación de calidad: Falta la firma del jefe")).toBeDefined()
  })

  it("los avisos de taller y de revisión salen como insignias dentro de la vista previa", () => {
    const { table } = renderTable([row({ inWorkshop: true, worksiteId: null, worksiteName: null, vehicleId: null, equipmentLabel: "Texto libre", detail: { unlinkedEquipment: true, unlinkedWorksite: true } })])
    fireEvent.click(within(table).getByRole("button", { name: /Cambio de bomba hidráulica/ }))
    const dialog = screen.getByRole("dialog", { name: "Texto libre" })
    expect(within(dialog).getByText("Sigue en taller")).toBeDefined()
    expect(within(dialog).getByText("Equipo sin identificar")).toBeDefined()
    expect(within(dialog).getByText("Faena sin identificar")).toBeDefined()
  })

  it("«Abrir la ficha completa» lleva a la fuente del trabajo", () => {
    const { table } = renderTable([fullRow()])
    const dialog = openFromTable(table, "Cambio de bomba hidráulica")
    expect(within(dialog).getByRole("link", { name: "Abrir la ficha completa" }).getAttribute("href")).toBe("/mantencion/registros/historicos/ot-1")
  })

  it("la tarjeta móvil abre la misma vista previa que la tabla", () => {
    renderTable([fullRow()])
    fireEvent.click(within(screen.getByRole("list", { name: CARDS_LABEL })).getByRole("button", { name: /Vista previa del trabajo de EQ-01/ }))
    const dialog = screen.getByRole("dialog", { name: "EQ-01 · ABCD12" })
    expect(within(dialog).getByText("Observación de calidad: Falta la firma del jefe")).toBeDefined()
  })

  it("se cierra con Escape", async () => {
    const { table } = renderTable([fullRow()])
    openFromTable(table, "Cambio de bomba hidráulica")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})
