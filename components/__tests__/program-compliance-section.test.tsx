// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"
import { buildSlotCalendar } from "@/lib/prevention/slot-compliance-calendar"

const TODAY = { year: 2026, month: 6, week: 2 }
const noun = { singular: "faena", plural: "faenas" }

function calendarOf(slots: Parameters<typeof buildSlotCalendar>[0]["slots"], unscheduledExtra = false) {
  return buildSlotCalendar({
    year: 2026,
    today: TODAY,
    rows: [{ id: "a", label: "Faena Alfa" }, { id: "b", label: "Faena Beta" }],
    slots: unscheduledExtra ? [...slots, { rowId: "a", month: null, week: null, status: "pending" }] : slots,
  })
}

const slots = [
  { rowId: "a", month: 1, week: 2, status: "completed" as const },
  { rowId: "a", month: 2, week: 2, status: "pending" as const },
  { rowId: "b", month: 2, week: 2, status: "pending" as const },
  { rowId: "b", month: 3, week: 2, status: "pending" as const },
]

function renderSection(extra: Partial<Parameters<typeof ProgramComplianceSection>[0]> = {}) {
  return render(
    <ProgramComplianceSection
      title="Cumplimiento del programa 2026"
      caption="Cumplimiento mensual 2026, por faena"
      calendar={calendarOf(slots)}
      noun={noun}
      hrefFor={(rowId, month) => `/vista?faena=${rowId}&mes=${month}`}
      clearHref="/vista?sin=filtro"
      {...extra}
    />,
  )
}

describe("ProgramComplianceSection", () => {
  it("responde la pregunta antes del dibujo: la frase resumen va en el encabezado de la figura", () => {
    renderSection()
    const figure = screen.getByRole("figure", { name: "Cumplimiento del programa 2026" })
    expect(within(figure).getByText("2 de 2 faenas tienen actividades vencidas sin cumplir; la más atrasada es Faena Beta, con 2 actividades en 2 meses.")).toBeDefined()
  })

  it("es una tabla de faenas × doce meses con el estado en texto", () => {
    renderSection()
    const table = screen.getByRole("table", { name: "Cumplimiento mensual 2026, por faena" })
    expect(within(table).getAllByRole("columnheader")).toHaveLength(13)
    expect(within(table).getByRole("rowheader", { name: "Faena Alfa" })).toBeDefined()
    expect(within(table).getAllByText("Vencido sin cumplir, 0 de 1 hecha").length).toBeGreaterThan(0)
    expect(within(table).getByText("Cumplido, 1 de 1 hecha")).toBeDefined()
  })

  it("cada mes exigible es un enlace que filtra por faena y mes; los no exigibles no lo son", () => {
    renderSection()
    const table = screen.getByRole("table", { name: "Cumplimiento mensual 2026, por faena" })
    const hrefs = within(table).getAllByRole("link").map((link) => link.getAttribute("href"))
    // Faena Alfa: enero y febrero; Faena Beta: febrero y marzo. Los otros 20 meses son «no exigible».
    expect(hrefs).toEqual([
      "/vista?faena=a&mes=1",
      "/vista?faena=a&mes=2",
      "/vista?faena=b&mes=2",
      "/vista?faena=b&mes=3",
    ])
  })

  it("marca la celda que filtra y, al hacerle clic otra vez, quita el filtro", () => {
    renderSection({ selected: { rowId: "b", month: 2 } })
    const table = screen.getByRole("table", { name: "Cumplimiento mensual 2026, por faena" })
    const current = within(table).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "true")
    expect(current).toHaveLength(1)
    expect(current[0]!.getAttribute("href")).toBe("/vista?sin=filtro")
  })

  it("«Ver datos» entrega las cifras por faena", () => {
    renderSection()
    const figure = screen.getByRole("figure", { name: "Cumplimiento del programa 2026" })
    expect(within(figure).getByText("Ver datos")).toBeDefined()
    const dataTable = within(figure).getByRole("table", { name: /cifras por faena/ })
    expect(within(dataTable).getByRole("columnheader", { name: "Meses con atraso" })).toBeDefined()
    expect(within(dataTable).getByRole("rowheader", { name: "Faena Beta" })).toBeDefined()
  })

  it("avisa de las actividades que no tienen mes y no caben en el calendario", () => {
    renderSection({ calendar: calendarOf(slots, true) })
    expect(screen.getByText("1 actividad exigible no tiene mes programado y no aparece en el calendario.")).toBeDefined()
  })

  it("sin casillas y sin estado vacío propio no pinta nada", () => {
    const { container } = renderSection({ calendar: { rows: [], unscheduled: 0 } })
    expect(container.innerHTML).toBe("")
  })

  it("sin casillas y con estado vacío, explica el vacío en vez de dibujar ejes en blanco", () => {
    renderSection({
      calendar: { rows: [], unscheduled: 0 },
      empty: { label: "Todavía no hay casillas", hint: "Se generan al activar el programa." },
    })
    expect(screen.getByText("Todavía no hay casillas")).toBeDefined()
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("ProgramComplianceSection — otros vocabularios y enlaces", () => {
  const closureWording = {
    unit: { singular: "cierre", plural: "cierres" },
    done: { singular: "hecho", plural: "hechos" },
    overdue: { singular: "vencido", plural: "vencidos" },
    noneDue: "Todavía no hay cierres exigibles.",
    naEmpty: "sin cierre exigible",
    naBeforeActivation: "anterior a la activación del programa",
  }

  it("una frase de cierres habla de cierres, no de actividades", () => {
    const calendar = buildSlotCalendar({
      year: 2026, today: TODAY, wording: closureWording,
      rows: [{ id: "a", label: "Faena Alfa" }],
      slots: [{ rowId: "a", month: 2, week: 4, status: "pending" }],
    })
    renderSection({ calendar, wording: closureWording })
    const figure = screen.getByRole("figure", { name: "Cumplimiento del programa 2026" })
    expect(within(figure).getByText("1 de 1 faena tiene cierres vencidos sin cumplir; la más atrasada es Faena Alfa, con 1 cierre en 1 mes.")).toBeDefined()
    expect(figure.textContent).not.toContain("actividad")
    // «Ver datos» también usa el vocabulario: encabezados de cierres.
    expect(within(figure).getByText("Cierres exigibles")).toBeDefined()
    expect(within(figure).getByText("Vencidos sin hacer")).toBeDefined()
  })

  it("los rótulos de estado propios llegan a la leyenda y a cada celda", () => {
    renderSection({ statusLabels: { ok: "Cerrado", missing: "Sin cerrar" } })
    const table = screen.getByRole("table", { name: "Cumplimiento mensual 2026, por faena" })
    expect(within(table).getByText("Cerrado, 1 de 1 hecha")).toBeDefined()
    expect(within(table).getAllByText("Sin cerrar, 0 de 1 hecha").length).toBeGreaterThan(0)
  })

  it("una fila sin a dónde llevar deja la celda sin enlace en vez de un enlace roto", () => {
    renderSection({ hrefFor: (rowId, month) => (rowId === "a" ? `/vista?faena=${rowId}&mes=${month}` : undefined), clearHref: undefined })
    const table = screen.getByRole("table", { name: "Cumplimiento mensual 2026, por faena" })
    expect(within(table).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/vista?faena=a&mes=1",
      "/vista?faena=a&mes=2",
    ])
  })
})

