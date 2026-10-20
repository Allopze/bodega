// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InspectionPageActions, InspectionRunList, NewRunDialog } from "./inspection-run-list"

// La URL es lo que la pantalla lee y escribe: `useUrlFilters` toma los
// parámetros de `useSearchParams` y los reescribe con `router.replace`. El mock
// deja fijar la query de partida y ver a qué URL navega cada control.
const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones",
}))

// El hook real, con `isPending` fijable: con un `router.replace` síncrono la transición
// termina antes de que una prueba pueda mirarla.
const urlFilters = vi.hoisted(() => ({ pending: false }))
vi.mock("@/lib/hooks/use-url-filters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/use-url-filters")>()
  return { ...actual, useUrlFilters: (...args: Parameters<typeof actual.useUrlFilters>) => ({ ...actual.useUrlFilters(...args), isPending: urlFilters.pending }) }
})

const actions = vi.hoisted(() => ({ createInspectionRunAction: vi.fn() }))
vi.mock("./actions", () => actions)

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
  nav.push.mockReset()
  urlFilters.pending = false
  actions.createInspectionRunAction.mockReset()
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

describe("bandeja de inspecciones — la tabla (L5)", () => {
  /** La tabla de escritorio, por su región: las tarjetas `md:hidden` no la comparten. */
  function tabla() {
    return screen.getByRole("region", { name: "Inspecciones" })
  }

  it("vive en un TableRoot con nombre: una región enfocable, no un div propio", () => {
    renderList()
    const region = tabla()
    expect(region).toHaveAttribute("tabindex", "0")
    // Escritorio y no tarjetas: bajo `md` la región entera se oculta.
    expect(region.className).toContain("hidden md:block")
    // Un solo contenedor con scroll: el `div overflow-x-auto` propio se fue.
    expect(region.parentElement?.querySelectorAll(".overflow-x-auto")).toHaveLength(1)
  })

  it("las columnas son Inspección, Faena / sujeto, Responsable, Estado, Fecha clave y Resultado", () => {
    renderList()
    const headers = within(tabla()).getAllByRole("columnheader").map((th) => th.textContent)
    // Sin «Tipo» (pasó a sublínea) y sin «Cumplimiento» ni «Hallazgos» sueltos (son «Resultado»).
    expect(headers).toEqual(["Inspección", "Faena / sujeto", "Responsable", "Estado", "Fecha clave", "Resultado"])
  })

  it("el responsable es una columna sólo desde xl y, bajo xl, una sublínea de la faena", () => {
    renderList()
    const cabecera = within(tabla()).getByRole("columnheader", { name: "Responsable" })
    expect(cabecera.className).toContain("hidden")
    expect(cabecera.className).toContain("xl:table-cell")

    // Misma persona, dos sitios: la celda de xl (oculta bajo xl) y «Resp.:» (oculta desde xl).
    const celdaXl = within(tabla()).getByRole("cell", { name: "Lorena Alvarado" })
    expect(celdaXl.className).toContain("xl:table-cell")
    const sublinea = within(tabla()).getByText("Resp.: Lorena Alvarado")
    expect(sublinea.className).toContain("xl:hidden")
  })

  it("el tipo de instrumento es la sublínea de la primera columna, no una columna", () => {
    renderList({ templateKind: "audit" })
    const fila = within(tabla()).getAllByRole("row")[1]!
    const primera = within(fila).getAllByRole("cell")[0]!
    expect(within(primera).getByText("Auditoría")).toBeTruthy()
    expect(within(primera).getByRole("link")).toHaveTextContent("Observación de Seguridad: Camión Ampliroll")
  })

  it("el resultado junta el cumplimiento y los hallazgos abiertos, con los graves entre paréntesis", () => {
    renderList({ status: "completed", compliancePercent: 80, openFindings: 3, criticalFindings: 2 })
    const celda = within(tabla()).getByText("80%").closest("td")!
    expect(within(celda).getByText("3 abiertos (2 graves)")).toBeTruthy()
  })

  it.each([
    [1, 1, "1 abierto (1 grave)"],
    [1, 0, "1 abierto"],
    [4, 1, "4 abiertos (1 grave)"],
    [0, 0, "Sin hallazgos"],
  ])("con %i abiertos y %i graves dice «%s»", (open, critical, texto) => {
    renderList({ status: "completed", compliancePercent: 100, openFindings: open, criticalFindings: critical })
    expect(within(tabla()).getByText(texto)).toBeTruthy()
  })

  it("«No calculable» no se parte: sans y sin cortes de línea, con su motivo", () => {
    renderList({ status: "cancelled" })
    const celda = within(tabla()).getByText("No calculable")
    expect(celda.className).toContain("whitespace-nowrap")
    // En mono (como el «80%») se partía en dos líneas en la columna angosta.
    expect(celda.className).not.toContain("font-mono")
    expect(celda).toHaveAttribute("title", "No calculable: la inspección se canceló sin ejecutarse.")
  })

  it("la fecha programada baja entera a su línea bajo xl y no se parte en el guion", () => {
    renderList({ status: "planned", scheduledFor: "2026-10-30" })
    const fecha = within(tabla()).getByText(/Programada · 30-10-2026/)
    // El salto va entre el rótulo y la fecha, y desde xl (donde cabe) se oculta.
    const salto = fecha.querySelector("br")!
    expect(salto.className).toContain("xl:hidden")
    // Sigue siendo un solo texto: el `<br>` no lo parte para quien lo lee ni para quien lo busca.
    expect(fecha.textContent).toBe("Programada · 30-10-2026")
  })

  it("la tarjeta móvil no fuerza ese salto: la fecha cabe en una línea", () => {
    renderList({ status: "planned", scheduledFor: "2026-10-30" })
    const tarjeta = screen.getByRole("link", { name: "INSP-2026-MEX_JILF" }).closest("article")!
    expect(within(tarjeta).getByText(/Programada · 30-10-2026/).querySelector("br")).toBeNull()
  })

  it("los hallazgos graves se dicen con palabras y no sólo con color", () => {
    renderList({ status: "completed", compliancePercent: 70, openFindings: 1, criticalFindings: 1 })
    const graves = within(tabla()).getByText("1 abierto (1 grave)")
    expect(graves.className).toContain("text-[var(--color-danger-ink)]")
  })
})

describe("bandeja de inspecciones — la tarjeta móvil (P2-18)", () => {
  /** La lista de tarjetas, que es la que se muestra bajo `md`. */
  function tarjetas() {
    return screen.getByRole("link", { name: "INSP-2026-MEX_JILF" }).closest("article")!
  }

  it("lleva el código como enlace, la plantilla, el estado y la acción", () => {
    renderList({ status: "in_progress" })
    const tarjeta = within(tarjetas())
    expect(tarjeta.getByRole("link", { name: "INSP-2026-MEX_JILF" })).toHaveAttribute("href", "/prevencion/inspecciones/run-1")
    expect(tarjeta.getByText("Observación de Seguridad: Camión Ampliroll")).toBeTruthy()
    expect(tarjeta.getByText("En ejecución")).toBeTruthy()
    // Se conserva la acción de siempre: continuar lo que está en curso.
    expect(tarjeta.getByRole("link", { name: "Continuar" })).toHaveAttribute("href", "/prevencion/inspecciones/run-1")
  })

  it("dice quién es el responsable, el tipo y la faena con su sujeto", () => {
    renderList({ templateKind: "observation" })
    const tarjeta = within(tarjetas())
    // Antes la tarjeta no decía quién responsable: se tenía que abrir la ficha.
    expect(tarjeta.getByText("Responsable").nextElementSibling).toHaveTextContent("Lorena Alvarado")
    expect(tarjeta.getByText("Tipo").nextElementSibling).toHaveTextContent("Observación planeada")
    expect(tarjeta.getByText("Faena y sujeto").nextElementSibling).toHaveTextContent("Teno - Arauco · KA122")
  })

  it("sin responsable dice «Sin asignar»", () => {
    renderList({ assigneeName: null })
    expect(within(tarjetas()).getByText("Responsable").nextElementSibling).toHaveTextContent("Sin asignar")
  })

  it("los hallazgos abiertos y los graves van en su propio campo", () => {
    renderList({ status: "completed", compliancePercent: 80, openFindings: 2, criticalFindings: 1 })
    const tarjeta = within(tarjetas())
    expect(tarjeta.getByText("Hallazgos").nextElementSibling).toHaveTextContent("2 abiertos · 1 grave")
    expect(tarjeta.getByText("Resultado").nextElementSibling).toHaveTextContent("80%")
  })

  it("sin hallazgos abiertos no inventa una cifra", () => {
    renderList({ status: "completed", compliancePercent: 100 })
    expect(within(tarjetas()).getByText("Hallazgos").nextElementSibling).toHaveTextContent("Sin hallazgos")
  })
})

describe("bandeja de inspecciones — la fila de KPI en 2×2 (L9)", () => {
  it("es una grilla de 2 columnas que pasa a 4 en lg, sin región con scroll", () => {
    renderList()
    const tiles = screen.getAllByRole("button", { pressed: false }).filter((node) => node.querySelector(".text-eyebrow"))
    const grilla = tiles[0]!.parentElement!
    expect(grilla.className).toContain("grid-cols-2")
    expect(grilla.className).toContain("lg:grid-cols-4")
    // La tira con scroll horizontal escondía el cuarto tile y era una región enfocable sin nombre.
    expect(grilla.className).not.toContain("overflow-x-auto")
    expect(grilla.className).not.toContain("flex")
    expect(tiles).toHaveLength(4)
  })

  it("reserva dos líneas al rótulo hasta xl para que las cifras queden alineadas", () => {
    renderList()
    const rotulo = screen.getByText("Con hallazgos abiertos")
    expect(rotulo.className).toContain("line-clamp-2")
    expect(rotulo.className).toContain("min-h-[2lh]")
    expect(rotulo.className).toContain("xl:min-h-0")
  })
})

describe("bandeja de inspecciones — avisos sobre la barra de filtros (L12)", () => {
  it("el aviso de programaciones vencidas es un Callout de advertencia", () => {
    renderList({}, { overdueProgramCount: 2 })
    const aviso = screen.getByText("2 programaciones vencidas").closest("div[class*='border']")!
    expect(aviso.className).toContain("--color-warning-tint")
    expect(within(aviso as HTMLElement).getByRole("link", { name: "Ver y regularizar" })).toBeTruthy()
  })

  it("las actividades programadas quedan entre los KPI y la barra de filtros, no al pie", () => {
    renderList({}, { activities: <p data-testid="actividades">3 actividades pendientes</p> })
    const actividades = screen.getByTestId("actividades")
    const buscador = screen.getByRole("searchbox", { name: "Buscar inspecciones" })
    const tabla = screen.getByRole("region", { name: "Inspecciones" })
    const kpi = screen.getByText("Con hallazgos abiertos")
    expect(kpi.compareDocumentPosition(actividades) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actividades.compareDocumentPosition(buscador) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actividades.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("sin avisos la lista empieza donde siempre", () => {
    renderList()
    expect(screen.queryByTestId("actividades")).toBeNull()
    expect(screen.queryByText(/programaciones? vencidas?/)).toBeNull()
  })
})

describe("bandeja de inspecciones — la barra de filtros (L9)", () => {
  it("la búsqueda ocupa su propia fila bajo xl y mide 256 px desde xl", () => {
    renderList()
    const contenedor = screen.getByRole("searchbox", { name: "Buscar inspecciones" }).parentElement!
    expect(contenedor.className).toContain("w-full")
    expect(contenedor.className).toContain("xl:w-64")
  })

  it("los selects van en contenedores de ancho fijo, que la barra no puede pasar a w-auto", () => {
    renderList()
    const anchos = ["Estado de la inspección", "Tipo de instrumento", "Faena"].map((nombre) =>
      screen.getByRole("combobox", { name: nombre }).parentElement!.className)
    expect(anchos[0]).toContain("sm:w-48")
    expect(anchos[1]).toContain("sm:w-44")
    expect(anchos[2]).toContain("sm:w-44")
  })

  it("«Más filtros» sigue en la barra", () => {
    renderList()
    expect(screen.getByRole("button", { name: "Más filtros" })).toBeTruthy()
  })
})

describe("bandeja de inspecciones — la lista avisa mientras se filtra (P2-19)", () => {
  it("marca aria-busy mientras la URL nueva se resuelve, y no antes", () => {
    const { rerender } = renderList()
    expect(screen.getByRole("region", { name: "Inspecciones" }).parentElement).not.toHaveAttribute("aria-busy")

    urlFilters.pending = true
    rerender(
      <InspectionRunList
        runs={[run()] as never}
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
      />,
    )
    expect(screen.getByRole("region", { name: "Inspecciones" }).parentElement).toHaveAttribute("aria-busy", "true")
  })
})

describe("bandeja de inspecciones — alta de una inspección (P2-8, L15)", () => {
  const TEMPLATE = { id: "t1", name: "Inspección de extintores", versionLabel: "01", kind: "inspection", sourceDefinitionCode: null }
  const CONTAINER_TEMPLATE = { id: "t2", name: "Inspección de contenedores", versionLabel: "01", kind: "inspection", sourceDefinitionCode: "inspeccion_contenedores" }
  const WORKSITE = { id: "w1", name: "Faena Norte" }

  function renderDialog(props: Record<string, unknown> = {}) {
    return render(
      <NewRunDialog
        templates={[TEMPLATE, CONTAINER_TEMPLATE]}
        worksites={[WORKSITE]}
        assignees={[]}
        subjectsByWorksite={{ w1: [] }}
        initialTemplateId="t1"
        initialWorksiteId="w1"
        initialOpen
        {...props}
      />,
    )
  }
  const dialogo = () => screen.getByRole("dialog", { name: "Nueva inspección" })
  const crear = () => within(dialogo()).getByRole("button", { name: "Crear inspección" })

  it("pide en este orden: plantilla, faena, sujeto, texto libre, programada y asignada", () => {
    renderDialog()
    const etiquetas = ["Plantilla", "Faena de la inspección", "Sujeto inspeccionado", "Identificación del sujeto", "Programada para", "Asignada a"]
    const nodos = etiquetas.map((nombre) =>
      nombre === "Identificación del sujeto" || nombre === "Programada para"
        ? within(dialogo()).getByText(nombre)
        : within(dialogo()).getByRole("combobox", { name: nombre }))
    for (let i = 1; i < nodos.length; i += 1) {
      expect(nodos[i - 1]!.compareDocumentPosition(nodos[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `«${etiquetas[i - 1]}» antes que «${etiquetas[i]}»`).toBeTruthy()
    }
  })

  it("«Origen» va plegado en «Más opciones» y su rótulo dice el valor vigente", () => {
    renderDialog()
    const resumen = within(dialogo()).getByText("Más opciones · Origen: Departamento de Prevención")
    const detalle = resumen.closest("details")!
    expect(detalle.open).toBe(false)
    // El selector sigue ahí (para quien abre el detalle), pero dentro del plegable y no entre los obligatorios.
    expect(detalle.querySelector("[aria-label='Origen']")).toBeTruthy()
    const asignada = within(dialogo()).getByRole("combobox", { name: "Asignada a" })
    expect(asignada.compareDocumentPosition(detalle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("el texto libre del sujeto sólo aparece con «Otro» y con una faena elegida", () => {
    // Con faena y sin sujeto del inventario elegido, «Otro / texto libre» es el valor.
    const { unmount } = renderDialog()
    expect(dialogo().querySelector("input[name='subjectType']")).toBeTruthy()
    expect(dialogo().querySelector("input[name='subjectLabel']")).toBeTruthy()
    unmount()

    // Sin faena no hay a qué sujeto referirse: los dos campos esperan.
    const sinFaena = renderDialog({ initialWorksiteId: undefined })
    expect(dialogo().querySelector("input[name='subjectLabel']")).toBeNull()
    sinFaena.unmount()

    // La plantilla de contenedores exige uno del catálogo: nada de texto libre.
    renderDialog({ initialTemplateId: "t2" })
    expect(dialogo().querySelector("input[name='subjectLabel']")).toBeNull()
    expect(within(dialogo()).getByRole("combobox", { name: "Contenedor inspeccionado" })).toBeTruthy()
  })

  it("las ayudas son frases cortas, de una línea cada una", () => {
    renderDialog()
    // L15: las ayudas largas de «Origen» y «Asignada a» desalineaban las filas de dos columnas.
    for (const ayuda of ["Ej.: extintor, camión.", "Si no está en el inventario.", "Opcional.", "Vacío: quien la crea."]) {
      expect(within(dialogo()).getByText(ayuda), ayuda).toBeTruthy()
      expect(ayuda.length).toBeLessThan(40)
    }
  })

  it("sin plantilla o sin faena no se puede crear, y ya no hay un aviso inalcanzable", () => {
    renderDialog({ initialTemplateId: undefined })
    expect(crear()).toBeDisabled()
    fireEvent.submit(crear().closest("form")!)
    expect(actions.createInspectionRunAction).not.toHaveBeenCalled()
    expect(screen.queryByText(/Selecciona conscientemente/)).toBeNull()
  })

  it("el servidor señala los campos y cada error queda bajo el suyo, sin repetirse arriba", async () => {
    actions.createInspectionRunAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados",
      fieldErrors: {
        templateId: ["La plantilla ya no está aprobada."],
        worksiteId: ["La faena está fuera de tu alcance."],
        subjectLabel: ["La identificación es demasiado larga."],
        scheduledFor: ["La fecha no es válida."],
        assignedToUserId: ["Esa persona no puede ejecutar inspecciones."],
      },
    })
    renderDialog()
    fireEvent.click(crear())

    for (const mensaje of [
      "La plantilla ya no está aprobada.",
      "La faena está fuera de tu alcance.",
      "La identificación es demasiado larga.",
      "La fecha no es válida.",
      "Esa persona no puede ejecutar inspecciones.",
    ]) {
      const error = await within(dialogo()).findByText(mensaje)
      // Es el `<p role="alert">` de su `Field`, no un texto suelto.
      expect(error).toHaveAttribute("role", "alert")
    }
    // El aviso general sería el mismo mensaje dos veces.
    expect(within(dialogo()).queryByText("Revisa los campos marcados")).toBeNull()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("un error sin campo sale como alerta del diálogo", async () => {
    actions.createInspectionRunAction.mockResolvedValue({ ok: false, message: "El submódulo Inspecciones está desactivado." })
    renderDialog()
    fireEvent.click(crear())

    const alerta = await within(dialogo()).findByRole("alert")
    expect(alerta).toHaveTextContent("El submódulo Inspecciones está desactivado.")
    // Un Callout de peligro, no el párrafo sin tono de antes.
    expect(alerta.className).toContain("--color-danger-tint")
  })

  it("mientras se crea, el botón muestra que trabaja y no se puede pulsar dos veces", async () => {
    let terminar: (value: unknown) => void = () => {}
    actions.createInspectionRunAction.mockReturnValue(new Promise((resolve) => { terminar = resolve }))
    renderDialog()
    fireEvent.click(crear())

    await waitFor(() => expect(crear()).toHaveAttribute("aria-busy", "true"))
    expect(crear()).toBeDisabled()
    // El nombre no cambia a «Creando…»: es el mismo botón con su estado de carga.
    expect(crear()).toHaveTextContent("Crear inspección")
    terminar({ ok: false, message: "Falló." })
    await waitFor(() => expect(crear()).toHaveAttribute("aria-busy", "false"))
  })

  it("al crear abre la inspección nueva y cierra el diálogo", async () => {
    actions.createInspectionRunAction.mockResolvedValue({ ok: true, data: { runId: "run-9", runCode: "INSP-9" } })
    renderDialog()
    fireEvent.click(crear())

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/prevencion/inspecciones/run-9"))
    expect(actions.createInspectionRunAction).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "t1",
      worksiteId: "w1",
      origin: "prevencion",
      assignedToUserId: null,
      scheduledFor: null,
    }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("reabrir el diálogo parte sin los errores del intento anterior", async () => {
    actions.createInspectionRunAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados",
      fieldErrors: { templateId: ["La plantilla ya no está aprobada."] },
    })
    renderDialog()
    fireEvent.click(crear())
    await within(dialogo()).findByText("La plantilla ya no está aprobada.")

    fireEvent.keyDown(dialogo(), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Nueva inspección" }))

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Nueva inspección" })).toBeTruthy())
    expect(screen.queryByText("La plantilla ya no está aprobada.")).toBeNull()
  })
})
