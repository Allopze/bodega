// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InspectionPageActions, InspectionRunList } from "./inspection-run-list"

// La URL es lo que la pantalla lee y escribe: `useUrlFilters` toma los
// parámetros de `useSearchParams` y los reescribe con `router.replace`. El mock
// deja fijar la query de partida y ver a qué URL navega cada control.
const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones",
}))

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
})

afterEach(cleanup)

/** Fija la query con la que parte la pantalla (lo que traería la URL). */
function startAt(query: string) {
  nav.params = new URLSearchParams(query)
}

/** Parámetros de la última URL a la que la pantalla navegó con `router.replace`. */
function lastNavigation() {
  const [url, options] = nav.replace.mock.calls.at(-1) ?? []
  expect(url, "la pantalla no navegó").toBeTruthy()
  // Los filtros no deben mover el scroll (AGENTS.md: patrón de navegación).
  expect(options).toEqual({ scroll: false })
  return new URL(String(url), "http://localhost").searchParams
}

/**
 * El tile de KPI por su rótulo. Por rol y no por texto: con la vista activa el
 * mismo rótulo aparece también en el chip «Vista», y `getByText` ve los dos.
 */
function tile(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) })
}

const TODAY = "2026-09-21"

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  code: "INSP-2026-MEX_JILF",
  status: "planned",
  templateName: "Observación de Seguridad: Camión Ampliroll",
  templateKind: "inspection",
  origin: "prevencion",
  assigneeName: "Lorena Alvarado",
  subjectLabel: "KA122",
  worksiteId: "ws-1",
  worksiteName: "Teno - Arauco",
  executedAt: null,
  scheduledFor: "2026-08-25",
  compliancePercent: null,
  nonConformingCount: 0,
  openFindings: 0,
  criticalFindings: 0,
  ...over,
})

const summary = { total: 1, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 }

function renderList(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return render(
    <InspectionRunList
      runs={[run(over)] as never}
      summary={summary}
      page={1}
      pageSize={25}
      overdueProgramCount={0}
      today={TODAY}
      canExecute={false}
      canReview
      templates={[]}
      worksites={[]}
      assignees={[]}
      subjectsByWorksite={{}}
      {...props}
    />,
  )
}

describe("bandeja de inspecciones — el rojo de 'Vencida'", () => {
  it("no marca vencida una inspección cancelada con fecha pasada", () => {
    // Las dos vistas viven a la vez en el DOM (tarjetas `md:hidden` + tabla
    // `hidden md:block`), así que buscar en todo el árbol prueba las dos: la
    // tabla comparaba sólo la fecha y pintaba "Vencida" en rojo sobre una
    // cancelada, mientras el KPI "Vencidas" la contaba en cero.
    renderList({ status: "cancelled" })
    // `/Vencida ·/` y no `/Vencida/`: el tile del KPI se llama "Vencidas".
    expect(screen.queryAllByText(/Vencida ·/)).toHaveLength(0)
    expect(screen.queryAllByText(/Programada · 25-08-2026/).length).toBeGreaterThan(0)
  })

  it("sí marca vencida una planificada con fecha pasada, en ambas vistas", () => {
    renderList({ status: "planned" })
    expect(screen.queryAllByText(/Vencida · 25-08-2026/)).toHaveLength(2)
  })
})

describe("bandeja de inspecciones — densidad de la fila de KPI (A1)", () => {
  it("expone cuatro tiles y ninguno navega fuera de la lista", () => {
    renderList()
    const tiles = screen.getAllByRole("button", { pressed: false })
      .filter((node) => node.className.includes("text-eyebrow") || node.querySelector(".text-eyebrow"))
    expect(tiles).toHaveLength(4)
    expect(screen.queryByText("Programaciones vencidas")).toBeNull()
  })

  it("un tile en cero no es pulsable y afirma el estado bueno", () => {
    renderList()
    const zero = screen.getByText("Con hallazgos abiertos").closest("button")
    expect(zero).toBeDisabled()
    expect(screen.getByText("Sin hallazgos abiertos")).toBeTruthy()
  })

  it("el aviso de programaciones vencidas aparece sólo cuando hay alguna", () => {
    const { unmount } = renderList()
    expect(screen.queryByRole("link", { name: "Ver y regularizar" })).toBeNull()
    unmount()
    renderList({}, { overdueProgramCount: 3 })
    expect(screen.getByText("3 programaciones vencidas")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver y regularizar" })).toHaveAttribute(
      "href", "/prevencion/inspecciones/programacion?vista=vencidas",
    )
  })
})

describe("bandeja de inspecciones — cumplimiento no calculable (A6)", () => {
  it("usa la misma etiqueta en tarjeta y tabla, y explica el motivo", () => {
    renderList({ status: "cancelled" })
    // Antes la tarjeta decía "Aún no calculable" y la tabla "No calculable".
    expect(screen.queryAllByText("Aún no calculable")).toHaveLength(0)
    const celdas = screen.queryAllByText("No calculable")
    expect(celdas).toHaveLength(2)
    for (const celda of celdas) {
      expect(celda).toHaveAttribute("title", "No calculable: la inspección se canceló sin ejecutarse.")
    }
  })

  it("el motivo cambia con el estado de la ejecución", () => {
    renderList({ status: "planned" })
    expect(screen.queryAllByText("No calculable")[0]).toHaveAttribute(
      "title", "No calculable: la inspección aún no se ejecuta.",
    )
  })
})

describe("bandeja de inspecciones — la cabecera sólo lleva acciones", () => {
  it("ya no repite las rutas hermanas que el menú lateral lista", () => {
    render(
      <InspectionPageActions
        canCreate={false}
        canExport
        templates={[]}
        worksites={[]}
        assignees={[]}
        subjectsByWorksite={{}}
        exportQuery=""
      />,
    )
    // Queda la única acción de página que no es el verbo primario.
    expect(screen.getByRole("link", { name: "Exportar Excel" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Plantillas" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Programación" })).toBeNull()
    // El menú de overflow existía sólo para esas dos rutas en móvil.
    expect(screen.queryByRole("button", { name: "Más acciones de inspecciones" })).toBeNull()
  })
})

const zeroSummary = { total: 1, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 }

describe("bandeja de inspecciones — el cero de un tile bajo filtro (P1-9)", () => {
  it("con una faena activa el cero dice «Ninguna con estos filtros», no el estado bueno", () => {
    startAt("faena=ws-1")
    renderList({}, { summary: zeroSummary })
    // Los cuatro tiles están en cero y ninguno puede afirmar «todo al día»: el
    // cero es relativo a la faena elegida.
    expect(screen.getAllByText("Ninguna con estos filtros")).toHaveLength(4)
    expect(screen.queryByText("Sin hallazgos abiertos")).toBeNull()
    expect(screen.queryByText("Ninguna fuera de plazo")).toBeNull()
    expect(screen.queryByText("Ninguno alto ni crítico")).toBeNull()
    expect(screen.queryByText("Nada esperando tu revisión")).toBeNull()
  })

  it.each([
    ["tipo", "tipo=audit"],
    ["búsqueda", "q=extintor"],
    ["«Más filtros» (responsable)", "responsable=u1"],
    ["«Más filtros» (rango de ejecución)", "desde=2026-01-01"],
  ])("también con el filtro de %s", (_name, query) => {
    startAt(query)
    renderList({}, { summary: zeroSummary })
    expect(screen.getAllByText("Ninguna con estos filtros")).toHaveLength(4)
  })

  it("el estado y la vista no cuentan como «otros filtros»: no cambian los KPI", () => {
    // Los KPI ignoran estado y vista (son subconjuntos, no universo), así que
    // un cero bajo `?estado=completed` sigue siendo un cero «de verdad».
    startAt("estado=completed")
    renderList({}, { summary: zeroSummary })
    expect(screen.queryByText("Ninguna con estos filtros")).toBeNull()
    expect(screen.getByText("Sin hallazgos abiertos")).toBeTruthy()
    expect(screen.getByText("Ninguna fuera de plazo")).toBeTruthy()
  })

  it("bajo ?estado=completed el tile de pendientes no dice «Nada esperando…» si hay pendientes", () => {
    // Era el defecto: el resumen se calculaba con el estado y la lista mostraba
    // una fila mientras el tile decía 0 y «Nada esperando revisión».
    startAt("estado=completed")
    renderList({ status: "completed" }, { summary: { ...zeroSummary, pendingReview: 1 } })
    expect(screen.queryByText(/Nada esperando/)).toBeNull()
    expect(tile("Pendientes de revisión")).toBeEnabled()
    expect(screen.getByText("Puedes revisarlas tú")).toBeTruthy()
  })
})

describe("bandeja de inspecciones — texto del tile de pendientes según el permiso de revisión", () => {
  it("con permiso de revisión es «para mí»", () => {
    renderList({}, { summary: { ...zeroSummary, pendingReview: 2 }, canReview: true })
    expect(screen.getByText("Puedes revisarlas tú")).toBeTruthy()
    expect(screen.queryByText("Esperan a Prevención")).toBeNull()
  })

  it("sin permiso de revisión son las que esperan a Prevención", () => {
    renderList({}, { summary: { ...zeroSummary, pendingReview: 2 }, canReview: false })
    expect(screen.getByText("Esperan a Prevención")).toBeTruthy()
    expect(screen.queryByText("Puedes revisarlas tú")).toBeNull()
  })

  it("en cero, el texto del estado bueno también distingue quién mira", () => {
    const { unmount } = renderList({}, { summary: zeroSummary, canReview: true })
    expect(screen.getByText("Nada esperando tu revisión")).toBeTruthy()
    unmount()
    renderList({}, { summary: zeroSummary, canReview: false })
    expect(screen.getByText("Nada esperando revisión")).toBeTruthy()
  })
})

describe("bandeja de inspecciones — un tile elige la vista y suelta el estado y la página", () => {
  it("el clic desde ?estado=planned&pagina=2 deja la URL sin estado ni pagina", () => {
    // `estado=planned&vista=pending_review` era una intersección siempre vacía:
    // dos controles para la misma dimensión (A5). Y seguir en la página 2 de una
    // lista nueva caía en una página sin filas.
    startAt("estado=planned&pagina=2&faena=ws-1")
    renderList({}, { summary: { ...zeroSummary, pendingReview: 3 } })
    fireEvent.click(tile("Pendientes de revisión"))
    const params = lastNavigation()
    expect(params.has("estado")).toBe(false)
    expect(params.has("pagina")).toBe(false)
    expect(params.get("vista")).toBe("pending_review")
    // Lo demás se conserva: el tile no es «limpiar filtros».
    expect(params.get("faena")).toBe("ws-1")
  })

  it("pulsar el tile activo apaga la vista", () => {
    startAt("vista=critical&pagina=2")
    renderList({}, { summary: { ...zeroSummary, withCriticalFindings: 2 } })
    fireEvent.click(tile("Con hallazgo grave"))
    const params = lastNavigation()
    expect(params.has("vista")).toBe(false)
    expect(params.has("pagina")).toBe(false)
  })

  it("el tile activo se distingue sin depender del color y conserva aria-pressed", () => {
    startAt("vista=critical")
    // En cero y activo sigue siendo pulsable: es la única salida de una vista vacía.
    renderList({}, { summary: zeroSummary })
    const active = tile("Con hallazgo grave")
    expect(active).toHaveAttribute("aria-pressed", "true")
    expect(active).toBeEnabled()
    expect(within(active).getByText("Filtrando la lista")).toBeTruthy()
    // Los demás no están presionados ni dicen «Filtrando la lista».
    expect(tile("Vencidas")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getAllByText("Filtrando la lista")).toHaveLength(1)
  })
})

describe("bandeja de inspecciones — chips de filtros activos", () => {
  it("la vista rápida deja su chip «Vista» y se puede quitar", () => {
    startAt("vista=critical&pagina=2")
    renderList({}, { summary: { ...zeroSummary, withCriticalFindings: 1 } })
    expect(screen.getByText("Filtros activos:")).toBeTruthy()
    const quitar = screen.getByRole("button", { name: "Eliminar filtro Vista" })
    // El chip nombra la vista con la misma etiqueta que el tile.
    expect(quitar.parentElement).toHaveTextContent("Vista:")
    expect(quitar.parentElement).toHaveTextContent("Con hallazgo grave")
    fireEvent.click(quitar)
    const params = lastNavigation()
    expect(params.has("vista")).toBe(false)
    expect(params.has("pagina")).toBe(false)
  })

  it("sin vista no hay chip «Vista»", () => {
    startAt("tipo=audit")
    renderList()
    expect(screen.queryByRole("button", { name: "Eliminar filtro Vista" })).toBeNull()
  })

  it.each([
    ["Estado", "estado=planned&pagina=3", "estado"],
    ["Tipo", "tipo=audit&pagina=3", "tipo"],
    ["Faena", "faena=ws-1&pagina=3", "faena"],
    ["Búsqueda", "q=extintor&pagina=3", "q"],
    ["Responsable", "responsable=u1&pagina=3", "responsable"],
    ["Ejecutada desde", "desde=2026-01-01&pagina=3", "desde"],
    ["Ejecutada hasta", "hasta=2026-01-31&pagina=3", "hasta"],
  ])("quitar el chip «%s» borra también la página", (label, query, key) => {
    startAt(query)
    renderList({}, { assignees: [{ id: "u1", name: "Lorena Alvarado" }] })
    fireEvent.click(screen.getByRole("button", { name: `Eliminar filtro ${label}` }))
    const params = lastNavigation()
    expect(params.has(key)).toBe(false)
    // Con el total distinto, seguir en la página 3 caería en una página vacía.
    expect(params.has("pagina")).toBe(false)
  })

  it("quitar el chip de búsqueda vacía también el borrador del buscador", () => {
    startAt("q=extintor")
    renderList()
    const buscador = screen.getByRole("searchbox", { name: "Buscar inspecciones" })
    expect(buscador).toHaveValue("extintor")
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Búsqueda" }))
    // Sin esto el debounce del borrador volvería a escribir `q` en la URL.
    expect(buscador).toHaveValue("")
  })
})

describe("bandeja de inspecciones — la paginación sigue avanzando", () => {
  it("ir a la página 2 escribe ?pagina=2 y no la borra a continuación", () => {
    // Guardia de la trampa: con `useUrlFilters({ pageKey: "pagina" })` el hook
    // borraría `pagina` justo después de ponerla y la lista no avanzaría nunca.
    startAt("tipo=audit")
    renderList({}, { summary: { ...zeroSummary, total: 120 }, pageSize: 50 })
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }))
    const params = lastNavigation()
    expect(params.get("pagina")).toBe("2")
    expect(params.get("tipo")).toBe("audit")
  })
})
