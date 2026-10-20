// @vitest-environment jsdom

import type { ComponentProps } from "react"
import Link from "next/link"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramItem } from "../../_components/catalog-types"
import { InspectionProgramsPanel, programStatusMeta } from "./programs-panel"

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones/programacion",
}))

const actions = vi.hoisted(() => ({
  createInspectionProgramAction: vi.fn(),
  runProgramNowAction: vi.fn(),
  updateInspectionProgramAction: vi.fn(),
}))
vi.mock("../../actions", () => actions)

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

const program = (over: Partial<ProgramItem> = {}): ProgramItem => ({
  id: "p1",
  templateId: "t1",
  worksiteId: "ws-1",
  templateName: "Inspección de Estado de Extintores",
  worksiteName: "Teno - Arauco",
  frequency: "monthly",
  intervalDays: 30,
  nextDueOn: "2099-01-01",
  assignedToUserId: null,
  assigneeName: null,
  riskEntryId: null,
  riskLabel: null,
  subjectType: null,
  subjectLabel: null,
  subjectResourceId: null,
  subjectVehicleId: null,
  subjectContainerId: null,
  templateDefinitionCode: null,
  isActive: true,
  templateApproved: true,
  version: 1,
  ...over,
})

const OVERDUE = "2020-01-01"

function renderPanel(programs: ProgramItem[], props: Partial<ComponentProps<typeof InspectionProgramsPanel>> = {}) {
  return render(<InspectionProgramsPanel programs={programs} assignees={[]} canManage={false} {...props} />)
}

/** La tabla y las tarjetas conviven en el DOM (una se oculta por CSS); la tabla es una sola. */
const table = () => within(screen.getByRole("table"))
const lastUrl = () => {
  const [url, options] = nav.replace.mock.calls.at(-1) ?? []
  return { url: new URL(String(url), "http://localhost"), options }
}

function pick(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }))
  fireEvent.click(screen.getByRole("option", { name: optionName }))
}

describe("programación: la barra de filtros", () => {
  it("tiene UN select de estado con Todos, Activas, Vencidas y Detenidas, y ningún botón suelto de «Sólo vencidas»", () => {
    renderPanel([program()])
    const estado = screen.getByRole("combobox", { name: "Filtrar programaciones por estado" })
    expect(screen.getAllByRole("combobox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Filtrar programaciones por estado",
      "Filtrar programaciones por faena",
    ])
    fireEvent.click(estado)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Todos los estados", "Activas", "Vencidas", "Detenidas",
    ])
    expect(screen.queryByRole("button", { name: /Sólo vencidas|Ver todas/ })).toBeNull()
  })

  it("«Vencidas» viaja como vista=vencidas (el enlace de la bandeja) y suelta el estado, sin tocar la faena", () => {
    nav.params = new URLSearchParams("estado=paused&faena=ws-1")
    renderPanel([program()])
    pick("Filtrar programaciones por estado", "Vencidas")
    const { url, options } = lastUrl()
    expect(url.searchParams.get("vista")).toBe("vencidas")
    expect(url.searchParams.has("estado")).toBe(false)
    expect(url.searchParams.get("faena")).toBe("ws-1")
    expect(options).toEqual({ scroll: false })
  })

  it("«Activas» y «Detenidas» viajan como estado y sueltan la vista", () => {
    nav.params = new URLSearchParams("vista=vencidas")
    renderPanel([program()])
    pick("Filtrar programaciones por estado", "Detenidas")
    expect(lastUrl().url.searchParams.get("estado")).toBe("paused")
    expect(lastUrl().url.searchParams.has("vista")).toBe(false)

    nav.params = new URLSearchParams("estado=paused")
    cleanup()
    renderPanel([program()])
    pick("Filtrar programaciones por estado", "Activas")
    expect(lastUrl().url.searchParams.get("estado")).toBe("active")
    expect(lastUrl().url.searchParams.has("vista")).toBe(false)
  })

  it("«Todos los estados» deja la URL sin estado ni vista", () => {
    nav.params = new URLSearchParams("vista=vencidas&faena=ws-1")
    renderPanel([program()])
    pick("Filtrar programaciones por estado", "Todos los estados")
    expect(lastUrl().url.searchParams.has("estado")).toBe(false)
    expect(lastUrl().url.searchParams.has("vista")).toBe(false)
    expect(lastUrl().url.searchParams.get("faena")).toBe("ws-1")
  })

  it("vista=vencidas deja el select en «Vencidas», muestra sólo las vencidas y las dice en un chip", () => {
    nav.params = new URLSearchParams("vista=vencidas")
    renderPanel([
      program({ id: "vencida", templateName: "Vencida de ayer", nextDueOn: OVERDUE }),
      program({ id: "al-dia", templateName: "Al día" }),
    ])
    expect(screen.getByRole("combobox", { name: "Filtrar programaciones por estado" }).textContent).toContain("Vencidas")
    expect(table().getByText("Vencida de ayer")).toBeTruthy()
    expect(table().queryByText("Al día")).toBeNull()
    expect(screen.getByText("Estado:")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Eliminar filtro Estado" })).toBeTruthy()
  })

  it("estado=overdue (enlace de antes) se lee como la vista de vencidas, y quitar el chip limpia las dos claves", () => {
    nav.params = new URLSearchParams("estado=overdue&faena=ws-1")
    renderPanel([
      program({ id: "vencida", templateName: "Vencida de ayer", nextDueOn: OVERDUE }),
      program({ id: "al-dia", templateName: "Al día" }),
    ])
    expect(screen.getByRole("combobox", { name: "Filtrar programaciones por estado" }).textContent).toContain("Vencidas")
    expect(table().getByText("Vencida de ayer")).toBeTruthy()
    expect(table().queryByText("Al día")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Estado" }))
    const { url } = lastUrl()
    expect(url.searchParams.has("estado")).toBe(false)
    expect(url.searchParams.has("vista")).toBe(false)
    expect(url.searchParams.get("faena")).toBe("ws-1")
  })

  it("estado=paused&vista=vencidas ya no da un vacío falso: manda la vista de vencidas", () => {
    nav.params = new URLSearchParams("estado=paused&vista=vencidas")
    renderPanel([program({ id: "vencida", templateName: "Vencida de ayer", nextDueOn: OVERDUE })])
    expect(table().getByText("Vencida de ayer")).toBeTruthy()
  })

  it("estado, faena y búsqueda aparecen como chips y «Limpiar filtros» los quita todos", () => {
    nav.params = new URLSearchParams("estado=active&faena=ws-1&q=extintor")
    renderPanel([
      program({ id: "a", templateName: "Inspección de Extintores" }),
      program({ id: "b", templateName: "Otra", worksiteId: "ws-2", worksiteName: "Santa Fe" }),
    ])
    for (const key of ["Estado", "Faena", "Búsqueda"]) {
      expect(screen.getByRole("button", { name: `Eliminar filtro ${key}` })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Faena" }))
    expect(lastUrl().url.searchParams.has("faena")).toBe(false)
    expect(lastUrl().url.searchParams.get("estado")).toBe("active")

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(lastUrl().url.search).toBe("")
  })

  it("sin filtros activos no hay chips ni «Limpiar filtros»", () => {
    renderPanel([program()])
    expect(screen.queryByText("Filtros activos:")).toBeNull()
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull()
  })

  it("el contador dice cuántas se ven de cuántas hay cuando el filtro recorta", () => {
    renderPanel([program({ id: "a" }), program({ id: "b", templateName: "Otra" })])
    expect(screen.getByText("2 programaciones")).toBeTruthy()

    cleanup()
    nav.params = new URLSearchParams("q=otra")
    renderPanel([program({ id: "a" }), program({ id: "b", templateName: "Otra" })])
    expect(screen.getByText("1 de 2 programaciones")).toBeTruthy()
  })

  it("la búsqueda y los selects miden lo mismo (sm:h-9): no hay tres alturas", () => {
    renderPanel([program()])
    const search = screen.getByRole("searchbox", { name: "Buscar programaciones" })
    const heights = [
      search,
      screen.getByRole("combobox", { name: "Filtrar programaciones por estado" }),
      screen.getByRole("combobox", { name: "Filtrar programaciones por faena" }),
    ].map((control) => control.className.split(/\s+/).filter((token) => /^sm:h-/.test(token)))
    expect(heights).toEqual([["sm:h-9"], ["sm:h-9"], ["sm:h-9"]])
  })

  it("escribir en la búsqueda escribe q en la URL (con rebote) sin tocar los demás filtros", () => {
    vi.useFakeTimers()
    nav.params = new URLSearchParams("estado=active")
    renderPanel([program()])
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar programaciones" }), { target: { value: "ka122" } })
    expect(nav.replace).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })
    expect(lastUrl().url.searchParams.get("q")).toBe("ka122")
    expect(lastUrl().url.searchParams.get("estado")).toBe("active")
    expect(lastUrl().options).toEqual({ scroll: false })
  })

  it("sin programaciones no hay barra de filtros: sólo el estado vacío", () => {
    renderPanel([], { canManage: true, emptyAction: <button type="button">Nuevo programa</button> })
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
  })
})

describe("programación: la tabla", () => {
  it("columnas: Instrumento / faena, Próxima, Asignada a, Sujeto / riesgo, Estado y Acción", () => {
    renderPanel([program()], { canManage: true })
    expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Instrumento / faena", "Próxima", "Asignada a", "Sujeto / riesgo", "Estado", "Acción",
    ])
  })

  it("sólo «Sujeto / riesgo» se oculta bajo xl; la acción, el estado y la fecha nunca", () => {
    renderPanel([program()], { canManage: true })
    const hiddenBelowXl = table().getAllByRole("columnheader", { hidden: true })
      .filter((header) => header.className.split(/\s+/).includes("hidden"))
    expect(hiddenBelowXl.map((header) => header.textContent)).toEqual(["Sujeto / riesgo"])
    expect(hiddenBelowXl[0]?.className).toContain("xl:table-cell")
  })

  it("quien sólo mira no ve la columna «Acción» ni botones de gestión", () => {
    renderPanel([program()], { canManage: false })
    expect(table().queryByRole("columnheader", { name: "Acción" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Detener" })).toBeNull()
  })

  it("«Próxima» junta la fecha, «Mensual · cada N días» y, si venció, «Vencida»", () => {
    renderPanel([
      program({ id: "a", templateName: "Programa al día", nextDueOn: "2099-03-05", intervalDays: 30 }),
      program({ id: "b", templateName: "Programa atrasado", nextDueOn: OVERDUE, frequency: "daily", intervalDays: 1 }),
    ])
    const [alDia, vencida] = [table().getByText("Programa al día"), table().getByText("Programa atrasado")]
      .map((cell) => cell.closest("tr") as HTMLElement)
    expect(within(alDia!).getByText("05-03-2099")).toBeTruthy()
    expect(within(alDia!).getByText("Mensual · cada 30 días")).toBeTruthy()
    // La etiqueta de estado «Activa» es otra cosa: «Vencida» sólo aparece si venció.
    expect(within(alDia!).queryByText("Vencida")).toBeNull()
    expect(within(vencida!).getByText("01-01-2020")).toBeTruthy()
    expect(within(vencida!).getByText("Diaria · cada 1 día")).toBeTruthy()
    // En la fila vencida «Vencida» está dos veces: bajo la fecha y como estado.
    expect(within(vencida!).getAllByText("Vencida")).toHaveLength(2)
  })

  it("el sujeto elegido del inventario se muestra por su nombre, no como «No especificado»", () => {
    renderPanel([
      program({ id: "a", subjectLabel: "KA122", subjectType: "camion" }),
      program({ id: "b", subjectType: "camion" }),
      program({ id: "c" }),
    ])
    // Dos veces: la columna (de `xl`) y la sublínea del instrumento (bajo `xl`).
    expect(table().getAllByText("KA122")).toHaveLength(2)
    expect(table().getAllByText("Camión")).toHaveLength(2)
    expect(table().getAllByText("Sin sujeto definido")).toHaveLength(2)
    expect(screen.queryByText("No especificado")).toBeNull()
  })

  it("el riesgo MIPER acompaña al sujeto en la columna y en la sublínea que la reemplaza bajo xl", () => {
    renderPanel([program({ riskLabel: "R-014 · Atropello de personas" })])
    const risks = table().getAllByText("MIPER · R-014 · Atropello de personas")
    expect(risks).toHaveLength(2)
    // Una vive en la columna de `xl` (sin `xl:hidden`) y la otra la reemplaza por debajo.
    expect(risks.filter((node) => node.className.split(/\s+/).includes("xl:hidden"))).toHaveLength(1)
    expect(risks.filter((node) => node.closest("td")?.className.split(/\s+/).includes("xl:table-cell"))).toHaveLength(1)
  })

  it("«Sin asignar» sólo cuando nadie la tiene; si no, el nombre", () => {
    renderPanel([
      program({ id: "a", templateName: "Con dueño", assignedToUserId: "u1", assigneeName: "Admin E2E" }),
      program({ id: "b", templateName: "Sin dueño" }),
    ])
    expect(table().getAllByText("Admin E2E")).toHaveLength(1)
    expect(table().getAllByText("Sin asignar")).toHaveLength(1)
  })

  it("«Estado» lleva el mismo badge en la tabla y en la tarjeta móvil", () => {
    const programs = [
      program({ id: "a", templateName: "P activa" }),
      program({ id: "b", templateName: "P vencida", nextDueOn: OVERDUE }),
      program({ id: "c", templateName: "P detenida", isActive: false }),
      program({ id: "d", templateName: "P reemplazada", templateApproved: false }),
    ]
    renderPanel(programs)
    const cards = screen.getAllByRole("article")
    expect(cards).toHaveLength(4)
    const expected = ["Activa", "Vencida", "Detenida", "Plantilla reemplazada"]
    programs.forEach((item, index) => {
      const row = table().getByText(item.templateName).closest("tr") as HTMLElement
      const rowBadge = row.querySelectorAll("span[class*='radius-full']")
      const cardBadge = cards[index]!.querySelectorAll("span[class*='radius-full']")
      expect(Array.from(rowBadge).map((node) => node.textContent)).toEqual([expected[index]])
      expect(Array.from(cardBadge).map((node) => node.textContent)).toEqual([expected[index]])
      // Y el mismo color: la clase de la variante coincide.
      expect(cardBadge[0]?.className).toBe(rowBadge[0]?.className)
    })
  })

  it("programStatusMeta: la plantilla reemplazada gana sobre detenida, y detenida sobre vencida", () => {
    const today = "2026-10-20"
    expect(programStatusMeta({ isActive: true, templateApproved: true, nextDueOn: "2026-12-01" }, today)).toEqual({ label: "Activa", variant: "success" })
    expect(programStatusMeta({ isActive: true, templateApproved: true, nextDueOn: "2026-10-01" }, today)).toEqual({ label: "Vencida", variant: "warning" })
    expect(programStatusMeta({ isActive: false, templateApproved: true, nextDueOn: "2026-10-01" }, today)).toEqual({ label: "Detenida", variant: "outline" })
    expect(programStatusMeta({ isActive: false, templateApproved: false, nextDueOn: "2026-10-01" }, today)).toEqual({ label: "Plantilla reemplazada", variant: "warning" })
  })

  it("la fila ofrece «Crear y abrir inspección», «Editar» y «Detener» (nombres que el E2E usa)", () => {
    renderPanel([program()], { canManage: true })
    const row = table().getByText("Inspección de Estado de Extintores").closest("tr") as HTMLElement
    for (const name of ["Crear y abrir inspección", "Editar", "Detener"]) {
      expect(within(row).getByRole("button", { name })).toBeTruthy()
    }
  })

  it("una detenida ofrece «Reactivar» y ya no «Crear y abrir inspección»", () => {
    renderPanel([program({ isActive: false })], { canManage: true })
    const row = table().getByText("Inspección de Estado de Extintores").closest("tr") as HTMLElement
    expect(within(row).getByRole("button", { name: "Reactivar" })).toBeTruthy()
    expect(within(row).queryByRole("button", { name: "Crear y abrir inspección" })).toBeNull()
    expect(within(row).queryByRole("button", { name: "Detener" })).toBeNull()
  })

  it("con la plantilla ya no aprobada el texto dice por qué no produce inspecciones, en vez de un botón que fallaría", () => {
    renderPanel([program({ templateApproved: false })], { canManage: true })
    const row = table().getByText("Inspección de Estado de Extintores").closest("tr") as HTMLElement
    expect(within(row).queryByRole("button", { name: "Crear y abrir inspección" })).toBeNull()
    expect(within(row).getByText(/No generará inspecciones: su plantilla ya no está aprobada/)).toBeTruthy()
  })

  it("«Crear y abrir inspección» abre la ejecución que crea el servidor", async () => {
    actions.runProgramNowAction.mockResolvedValue({ ok: true, data: { runId: "run-9" } })
    renderPanel([program({ nextDueOn: OVERDUE })], { canManage: true })
    const row = table().getByText("Inspección de Estado de Extintores").closest("tr") as HTMLElement
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Crear y abrir inspección" })) })
    expect(actions.runProgramNowAction).toHaveBeenCalledWith({ programId: "p1" })
  })
})

describe("programación: la tarjeta móvil", () => {
  it("lleva la identidad, el estado, la cadencia, el sujeto y las acciones de la fila", () => {
    renderPanel([
      program({ subjectLabel: "KA122", riskLabel: "R-014 · Atropello", assigneeName: "Admin E2E", nextDueOn: OVERDUE }),
    ], { canManage: true })
    const card = within(screen.getByRole("article"))
    expect(card.getByRole("heading", { name: "Inspección de Estado de Extintores" })).toBeTruthy()
    expect(card.getByText("Teno - Arauco")).toBeTruthy()
    expect(card.getByText("Mensual · cada 30 días")).toBeTruthy()
    expect(card.getByText("KA122")).toBeTruthy()
    expect(card.getByText("R-014 · Atropello")).toBeTruthy()
    expect(card.getByText("Admin E2E")).toBeTruthy()
    for (const name of ["Crear y abrir inspección", "Editar", "Detener"]) {
      expect(card.getByRole("button", { name })).toBeTruthy()
    }
  })
})

describe("programación: estados vacíos", () => {
  it("el estado vacío ofrece la acción real que se le pasa", () => {
    renderPanel([], { canManage: true, emptyAction: <button type="button">Nuevo programa</button> })
    expect(screen.getByText("Aún no hay programación")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Nuevo programa" })).toBeTruthy()
  })

  it("sin plantillas aprobadas el estado vacío lo dice y manda a Plantillas", () => {
    renderPanel([], {
      canManage: true,
      emptyDescription: "Para programar necesitas al menos una plantilla aprobada.",
      emptyAction: <Link href="/prevencion/inspecciones/plantillas">Ir a Plantillas</Link>,
    })
    expect(screen.getByText("Para programar necesitas al menos una plantilla aprobada.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a Plantillas" }).getAttribute("href")).toBe("/prevencion/inspecciones/plantillas")
  })

  it("con filtros que no dejan nada, el vacío ofrece limpiarlos", () => {
    nav.params = new URLSearchParams("q=no-existe")
    renderPanel([program()])
    expect(screen.getByText("No hay programaciones con estos filtros")).toBeTruthy()
    // «Limpiar filtros» está en la barra y en el estado vacío: los dos hacen lo mismo.
    const [first] = screen.getAllByRole("button", { name: "Limpiar filtros" })
    fireEvent.click(first!)
    expect(lastUrl().url.search).toBe("")
  })

  it("sin vencidas lo dice y «Ver todas» vuelve a la lista completa", () => {
    nav.params = new URLSearchParams("vista=vencidas&faena=ws-1")
    renderPanel([program()])
    expect(screen.getByText("No hay programaciones vencidas")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }))
    expect(lastUrl().url.searchParams.has("vista")).toBe(false)
    expect(lastUrl().url.searchParams.has("estado")).toBe(false)
    expect(lastUrl().url.searchParams.get("faena")).toBe("ws-1")
  })
})
