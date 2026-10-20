// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { InspectionFollowupRow } from "@/lib/services/prevention-inspection-followup"
import { FollowupTable } from "./followup-table"

// La URL es lo que la pantalla lee y escribe: el mock fija la query de partida y deja ver a qué URL navega
// cada control.
const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones/seguimiento",
}))

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const TODAY = "2026-10-20"

const WORKSITES = [
  { id: "ws-1", name: "Faena Norte" },
  { id: "ws-2", name: "Faena Sur" },
]

function row(over: Partial<InspectionFollowupRow> = {}): InspectionFollowupRow {
  return {
    findingId: "fnd-1",
    runId: "run-1",
    runCode: "INS-2026-AAA1",
    kind: "inspection",
    date: "2026-10-05",
    area: "Extintor QA 01",
    deviation: "Sello roto en el extintor",
    correctiveMeasure: "Reponer el sello de seguridad",
    responsible: "Ana Asignada",
    targetDate: "2026-11-02",
    status: "En proceso",
    progress: 40,
    comments: "",
    worksiteId: "ws-1",
    worksiteName: "Faena Norte",
    subjectLabel: "Extintor QA 01",
    criticality: "high",
    findingStatus: "capa_linked",
    actionId: "act-1",
    actionCode: "CAPA-2026-001",
    capaStatus: "in_progress",
    followupStatus: "abiertas",
    lastFollowup: { at: "2026-10-12T15:00:00.000Z", author: "Rodrigo Revisor", note: "Se pidió el repuesto" },
    ...over,
  }
}

const VENCIDA = row({
  findingId: "fnd-venc", runId: "run-venc", runCode: "INS-2026-VENC", deviation: "Manguera con grietas",
  actionId: "act-venc", actionCode: "CAPA-2026-VENC", correctiveMeasure: "Cambiar la manguera",
  targetDate: "2026-10-08", followupStatus: "vencidas", capaStatus: "pending", progress: 0, lastFollowup: null,
})
const SIN_CAPA = row({
  findingId: "fnd-sin", runId: "run-sin", runCode: "INS-2026-SINC", deviation: "Orden deficiente en la bodega",
  worksiteId: "ws-2", worksiteName: "Faena Sur", subjectLabel: null,
  actionId: null, actionCode: null, capaStatus: null, correctiveMeasure: "", responsible: "", targetDate: null,
  status: "Sin CAPA", progress: 0, findingStatus: "open", followupStatus: "sin_capa", lastFollowup: null,
})
const CERRADO_SIN_CAPA = row({
  findingId: "fnd-cer", runId: "run-cer", runCode: "INS-2026-CERR", deviation: "Señalética borrada",
  actionId: null, actionCode: null, capaStatus: null, correctiveMeasure: "", responsible: "", targetDate: null,
  status: "Sin CAPA", progress: 0, findingStatus: "closed", followupStatus: "cerradas", lastFollowup: null,
})

function renderTable(rows: InspectionFollowupRow[], props: Partial<React.ComponentProps<typeof FollowupTable>> = {}) {
  return render(<FollowupTable rows={rows} worksites={WORKSITES} filter={{}} today={TODAY} canViewCapa {...props} />)
}

/** La fila de la tabla (no la tarjeta móvil, que también está en el DOM) de un hallazgo. */
function tableRow(deviation: string) {
  const table = screen.getByRole("table")
  const cell = within(table).getByRole("link", { name: deviation })
  return cell.closest("tr")!
}

describe("Seguimiento de inspecciones — la tabla", () => {
  it("nombra las columnas en español claro, con Avance sólo desde xl", () => {
    renderTable([row()])
    const table = screen.getByRole("table")

    for (const name of ["Hallazgo", "Faena / sujeto", "Acción correctiva", "Plazo", "Estado", "Avance"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(name) })).toBeTruthy()
    }
    // La jerga del Anexo 15 no aparece en los encabezados de la pantalla.
    expect(within(table).queryByRole("columnheader", { name: /Fecha ejecución MC|% Cumplimiento|Status|Área/i })).toBeNull()
    // Avance es la única columna que se oculta, y sólo bajo xl.
    expect(within(table).getByRole("columnheader", { name: "Avance" }).className).toMatch(/hidden xl:table-cell/)
    for (const name of ["Hallazgo", "Acción correctiva", "Estado"]) {
      expect(within(table).getByRole("columnheader", { name }).className).not.toMatch(/\bhidden\b/)
    }
  })

  it("el hallazgo enlaza a su inspección y lleva fecha y código debajo", () => {
    renderTable([row()])
    const current = tableRow("Sello roto en el extintor")

    expect(within(current).getByRole("link", { name: "Sello roto en el extintor" })).toHaveAttribute("href", "/prevencion/inspecciones/run-1")
    expect(current.textContent).toContain("05-10-2026 · INS-2026-AAA1")
  })

  it("separa la faena del sujeto en vez de mostrar sólo el sujeto", () => {
    renderTable([row(), SIN_CAPA])

    const withSubject = tableRow("Sello roto en el extintor")
    expect(within(withSubject).getByText("Faena Norte")).toBeTruthy()
    expect(within(withSubject).getByText("Extintor QA 01", { selector: "p" })).toBeTruthy()
    // Sin sujeto declarado queda la faena sola, sin un guion colgando.
    const withoutSubject = tableRow("Orden deficiente en la bodega")
    expect(within(withoutSubject).getByText("Faena Sur")).toBeTruthy()
  })

  it("la acción correctiva trae la medida, el responsable, el código CAPA enlazado y el último seguimiento", () => {
    renderTable([row()])
    const current = tableRow("Sello roto en el extintor")

    expect(within(current).getByText("Reponer el sello de seguridad")).toBeTruthy()
    expect(current.textContent).toContain("Responsable: Ana Asignada")
    expect(within(current).getByRole("link", { name: "CAPA-2026-001" })).toHaveAttribute("href", "/prevencion/capa/act-1")
    expect(current.textContent).toContain("Último seguimiento · 12-10-2026: Se pidió el repuesto")
  })

  it("sin permiso para ver CAPA el código se muestra pero no enlaza", () => {
    renderTable([row()], { canViewCapa: false })
    const current = tableRow("Sello roto en el extintor")

    expect(within(current).getByText("CAPA-2026-001")).toBeTruthy()
    expect(within(current).queryByRole("link", { name: "CAPA-2026-001" })).toBeNull()
  })

  it("el avance baja a la acción correctiva cuando la columna Avance no cabe", () => {
    renderTable([row()])
    const current = tableRow("Sello roto en el extintor")

    const sublinea = within(current).getByText(/^Avance:/)
    expect(sublinea.className).toMatch(/xl:hidden/)
    expect(sublinea.textContent).toContain("40 %")
  })

  it("el plazo explica en un Tooltip a qué columna del Anexo 15 equivale", async () => {
    renderTable([row()])
    const date = within(tableRow("Sello roto en el extintor")).getByText("02-11-2026")

    // Radix abre el Tooltip con el foco o el puntero; el contenido es el texto del plan.
    await act(async () => { fireEvent.focus(date) })
    expect((await screen.findAllByText(/Fecha comprometida para ejecutar la medida correctiva/)).length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain("«Fecha Ejecución MC» del Anexo 15")
  })

  it("rotula «Vencida» con los días de atraso, sólo en la fila vencida", () => {
    renderTable([row(), VENCIDA])

    // 08-10 → 20-10 son 12 días.
    expect(within(tableRow("Manguera con grietas")).getByText("Vencida hace 12 días")).toBeTruthy()
    expect(within(tableRow("Sello roto en el extintor")).queryByText(/Vencida/)).toBeNull()
  })

  it("el estado se dice UNA sola vez por fila: el de la acción CAPA, o la falta de ella", () => {
    renderTable([row(), SIN_CAPA, CERRADO_SIN_CAPA])

    // Con acción: la etiqueta del estado de la CAPA, y nada de «Sin CAPA».
    const withAction = tableRow("Sello roto en el extintor")
    expect(within(withAction).getAllByText("En proceso")).toHaveLength(1)
    expect(withAction.textContent).not.toMatch(/Sin CAPA|Sin acción CAPA/)

    // Sin acción: «Sin acción CAPA» una vez, y la columna de acción no lo repite.
    const withoutAction = tableRow("Orden deficiente en la bodega")
    expect(within(withoutAction).getAllByText("Sin acción CAPA")).toHaveLength(1)
    expect(withoutAction.textContent).not.toContain("Sin CAPA")
    // Y sin acción no hay plazo ni avance inventados: «0 %» sería afirmar un avance que no existe.
    expect(withoutAction.textContent).not.toContain("0 %")

    // Cerrado sin derivar a CAPA: no es lo mismo que «sin acción».
    const closed = tableRow("Señalética borrada")
    expect(within(closed).getAllByText("Cerrado sin CAPA")).toHaveLength(1)
    expect(within(closed).queryByText("Sin acción CAPA")).toBeNull()
  })

  it("respeta el orden que entrega el servidor (primero lo que pide atención)", () => {
    renderTable([VENCIDA, SIN_CAPA, row(), CERRADO_SIN_CAPA])

    const order = within(screen.getByRole("table")).getAllByRole("row").slice(1)
      .map((tr) => within(tr).getAllByRole("link")[0]!.textContent)
    expect(order).toEqual(["Manguera con grietas", "Orden deficiente en la bodega", "Sello roto en el extintor", "Señalética borrada"])
  })

  it("«Plazo» se puede ordenar, con los hallazgos sin plazo al final", () => {
    renderTable([SIN_CAPA, row(), VENCIDA])

    fireEvent.click(screen.getByRole("button", { name: /Ordenar por Plazo/ }))

    const order = within(screen.getByRole("table")).getAllByRole("row").slice(1)
      .map((tr) => within(tr).getAllByRole("link")[0]!.textContent)
    expect(order).toEqual(["Manguera con grietas", "Sello roto en el extintor", "Orden deficiente en la bodega"])
  })
})

describe("Seguimiento de inspecciones — tarjetas móviles", () => {
  it("cada hallazgo es una tarjeta con su estado, su plazo vencido y acciones de tamaño táctil", () => {
    renderTable([VENCIDA])
    const card = screen.getAllByRole("article")[0]!

    expect(within(card).getByText("Manguera con grietas")).toBeTruthy()
    expect(within(card).getByText("Pendiente")).toBeTruthy()
    expect(within(card).getByText("Vencida hace 12 días")).toBeTruthy()
    expect(within(card).getByText("Cambiar la manguera")).toBeTruthy()
    expect(within(card).getByRole("link", { name: "Ver inspección" })).toHaveAttribute("href", "/prevencion/inspecciones/run-venc")
    expect(within(card).getByRole("link", { name: "Ver acción CAPA-2026-VENC" })).toHaveAttribute("href", "/prevencion/capa/act-venc")
  })

  it("sin permiso para ver CAPA la tarjeta no ofrece «Ver acción»", () => {
    renderTable([VENCIDA], { canViewCapa: false })

    expect(within(screen.getAllByRole("article")[0]!).queryByRole("link", { name: /Ver acción/ })).toBeNull()
  })

  it("un hallazgo sin acción CAPA muestra su estado una vez y no inventa plazo ni avance", () => {
    renderTable([SIN_CAPA])
    const card = screen.getAllByRole("article")[0]!

    expect(within(card).getAllByText("Sin acción CAPA")).toHaveLength(1)
    expect(card.textContent).not.toContain("Plazo")
    expect(card.textContent).not.toContain("0 %")
    expect(within(card).queryByRole("link", { name: /Ver acción/ })).toBeNull()
  })
})

describe("Seguimiento de inspecciones — filtros", () => {
  /** Elige una opción de un select del toolbar: abre el combobox y pulsa la opción. */
  function choose(selectName: string, optionName: string) {
    fireEvent.click(screen.getByRole("combobox", { name: selectName }))
    fireEvent.click(screen.getByRole("option", { name: optionName }))
  }

  /** Parámetros de la última URL a la que la pantalla navegó con `router.replace`. */
  function lastNavigation() {
    const [url, options] = nav.replace.mock.calls.at(-1) ?? []
    expect(url, "la pantalla no navegó").toBeTruthy()
    // Los filtros no deben mover el scroll (AGENTS.md: patrón de navegación).
    expect(options).toEqual({ scroll: false })
    return new URL(String(url), "http://localhost").searchParams
  }

  it("ofrece búsqueda, faena, estado y tipo, con las etiquetas en español", () => {
    renderTable([row()])

    expect(screen.getByRole("searchbox", { name: "Buscar en el seguimiento" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Faena" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Tipo de instrumento" })).toBeTruthy()

    fireEvent.click(screen.getByRole("combobox", { name: "Estado" }))
    for (const label of ["Todos los estados", "Sin acción CAPA", "Abiertas", "Vencidas", "Cerradas"]) {
      expect(screen.getByRole("option", { name: label })).toBeTruthy()
    }
  })

  it("elegir un estado lo escribe en la URL con replace y sin mover el scroll", () => {
    renderTable([row()])

    choose("Estado", "Vencidas")

    expect(lastNavigation().get("estado")).toBe("vencidas")
  })

  it("elegir faena y tipo conserva los demás filtros de la URL", () => {
    nav.params = new URLSearchParams("estado=vencidas&q=sello")
    renderTable([row()], { filter: { status: "vencidas", search: "sello" } })

    choose("Faena", "Faena Sur")
    expect(Object.fromEntries(lastNavigation())).toEqual({ estado: "vencidas", q: "sello", faena: "ws-2" })

    choose("Tipo de instrumento", "Auditoría")
    expect(lastNavigation().get("tipo")).toBe("audit")
  })

  it("«Todos» borra el parámetro en vez de dejarlo vacío", () => {
    nav.params = new URLSearchParams("estado=vencidas")
    renderTable([row()], { filter: { status: "vencidas" } })

    choose("Estado", "Todos los estados")

    expect(lastNavigation().has("estado")).toBe(false)
  })

  it("el buscador escribe `q` en la URL con rebote", () => {
    vi.useFakeTimers()
    renderTable([row()])

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en el seguimiento" }), { target: { value: "sello" } })
    expect(nav.replace).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })

    expect(lastNavigation().get("q")).toBe("sello")
  })

  it("los filtros activos aparecen como chips con su nombre y se quitan uno a uno", () => {
    nav.params = new URLSearchParams("estado=sin_capa&faena=ws-2&tipo=observation&q=bodega")
    renderTable([SIN_CAPA], { filter: { status: "sin_capa", worksiteId: "ws-2", kind: "observation", search: "bodega" } })

    for (const text of ["Estado:", "Sin acción CAPA", "Faena:", "Faena Sur", "Tipo:", "Observación planeada", "Búsqueda:", "bodega"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Estado" }))
    const params = lastNavigation()
    expect(params.has("estado")).toBe(false)
    expect(params.get("faena")).toBe("ws-2")
  })

  it("«Limpiar filtros» vuelve a la ruta sin parámetros", () => {
    nav.params = new URLSearchParams("estado=vencidas&faena=ws-1")
    renderTable([VENCIDA], { filter: { status: "vencidas", worksiteId: "ws-1" } })

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))

    expect(nav.replace).toHaveBeenCalledWith("/prevencion/inspecciones/seguimiento", { scroll: false })
  })
})

describe("Seguimiento de inspecciones — estado vacío", () => {
  it("con filtros puestos dice que no hay resultados y ofrece un botón real para limpiarlos", () => {
    nav.params = new URLSearchParams("estado=vencidas")
    renderTable([], { filter: { status: "vencidas" } })

    // El estado vacío está dos veces en el DOM (tabla y lista móvil; una de las dos se oculta por CSS).
    expect(screen.getAllByText("No hay hallazgos con estos filtros").length).toBeGreaterThan(0)
    // «Limpiar filtros» también está en el toolbar; el último es el del estado vacío, que cierra el callejón.
    const buttons = screen.getAllByRole("button", { name: "Limpiar filtros" })
    expect(buttons.length).toBeGreaterThan(1)
    fireEvent.click(buttons.at(-1)!)
    expect(nav.replace).toHaveBeenCalledWith("/prevencion/inspecciones/seguimiento", { scroll: false })
  })

  it("sin filtros no ofrece limpiar nada", () => {
    renderTable([])

    expect(screen.getAllByText("Aún no hay hallazgos para seguir").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull()
  })
})
