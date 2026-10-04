// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider, useSafeShellHeader } from "@/components/layout/header-context"
import type { MiperPortfolioRow } from "@/lib/prevention/miper/portfolio"

const nav = vi.hoisted(() => ({ query: "" }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper", useSearchParams: () => new URLSearchParams(nav.query) }))
// El enlace de Next como `<a>`, dejando ver `replace` y `scroll` para afirmar cómo filtran las cifras.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, replace, scroll, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} data-replace={replace ? "true" : undefined} data-scroll={scroll === false ? "false" : undefined} {...rest}>{children as ReactNode}</a>
  ),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("./actions", () => ({ createMiperAction: vi.fn(), previewRiskImportAction: vi.fn(), commitRiskImportAction: vi.fn(), saveRiskFactorAction: vi.fn() }))

import { MiperHome } from "./miper-home"

const progress = { done: 1, late: 0, pending: 1, overdue: 0, failed: 0, planned: 2, ratio: 0.5 }
function row(overrides: Partial<MiperPortfolioRow>): MiperPortfolioRow {
  return {
    id: "ws-a", worksiteId: "ws-a", worksiteName: "Faena A", worksiteActive: true,
    matrix: { id: "m-a", period: 2026, versionNumber: 1, label: "Vigente · v1", isLegacy: false }, vigente: null,
    status: "vigente", stateLabel: "Vigente · v1", headcount: 12, headcountSource: "ficha", updatedAt: "2026-09-30T12:00:00.000Z",
    completeness: { complete: 3, total: 4 }, importantCount: 1, intolerableCount: 1, criticalWithoutControl: 1,
    requiresMyAction: false, myActions: [], submittedByName: null, programProgress: progress,
    ...overrides,
  }
}
const ROWS = [
  row({}),
  row({
    id: "ws-b", worksiteId: "ws-b", worksiteName: "Faena B", status: "en_revision", stateLabel: "En revisión por Prevención",
    matrix: { id: "m-b", period: 2026, versionNumber: null, label: "En revisión por Prevención", isLegacy: false },
    criticalWithoutControl: 0, requiresMyAction: true, myActions: [{ matrixId: "m-b", period: 2026, reason: "Pendiente de tu revisión", kind: "review" }], submittedByName: "Ana",
  }),
  row({
    id: "ws-c", worksiteId: "ws-c", worksiteName: "Faena C", matrix: null, status: "sin_miper", stateLabel: "Sin MIPER", headcount: 3,
    headcountSource: "trabajadores", updatedAt: null, completeness: null, importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0, programProgress: null,
  }),
]
const CREATION = [{ id: "ws-c", name: "Faena C", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false }]

/** El buscador del TopBar, reducido a lo que importa aquí: escribe en el `searchQuery` de la shell. */
function TopBarSearch() {
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  return <input aria-label="Filtrar en esta página" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
}

function show(query = "", rows: MiperPortfolioRow[] = ROWS, canEdit = true, creation = canEdit ? CREATION : []) {
  nav.query = query
  return render(
    <ShellHeaderProvider>
      <TopBarSearch />
      <MiperHome rows={rows} creationWorksites={creation} currentYear={2026} permissions={{ canEdit, canManageCatalog: false }} />
    </ShellHeaderProvider>,
  )
}
const search = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: "Filtrar en esta página" }), { target: { value: text } })
const tabla = () => within(screen.getByRole("table", { name: "MIPER por faena" }))

afterEach(() => {
  nav.query = ""
  vi.clearAllMocks()
})

describe("MiperHome — franja (A1: cada cifra lleva exactamente a su subconjunto)", () => {
  it("cuatro cifras sobre todas las faenas, con su destino, sin arrastrar filtros, con replace y sin scroll", () => {
    show("estado=vigente")
    const conMiper = screen.getByRole("link", { name: /^Faenas con MIPER/ })
    expect(conMiper).toHaveAttribute("href", "/prevencion/miper?estado=con_miper")
    expect(conMiper).toHaveTextContent("2/3")
    expect(screen.getByRole("link", { name: /^En revisión/ })).toHaveAttribute("href", "/prevencion/miper?estado=en_revision")
    expect(screen.getByRole("link", { name: /^Requieren mi acción/ })).toHaveAttribute("href", "/prevencion/miper?vista=mias")
    const sinControl = screen.getByRole("link", { name: /^Riesgos críticos sin control/ })
    expect(sinControl).toHaveAttribute("href", "/prevencion/miper?sincontrol=1")
    expect(sinControl).toHaveTextContent("1")
    expect(sinControl).toHaveAttribute("data-replace", "true")
    expect(sinControl).toHaveAttribute("data-scroll", "false")
  })

  it("una cifra en cero se ve pero no enlaza: no lleva a una lista vacía", () => {
    show("", [ROWS[2]!])
    for (const rotulo of ["Faenas con MIPER", "En revisión", "Requieren mi acción", "Riesgos críticos sin control"]) {
      expect(screen.queryByRole("link", { name: new RegExp(`^${rotulo}`) })).toBeNull()
    }
    expect(screen.getByText("Riesgos críticos sin control")).toBeInTheDocument()
    expect(screen.getByText("0/1")).toBeInTheDocument()
  })

  it("sin faenas a su alcance (0/0) no dice «Todas tienen MIPER»: el estado vacío de la lista ya explica la situación", () => {
    show("", [])
    expect(screen.getByText("0/0")).toBeInTheDocument()
    expect(screen.queryByText("Todas tienen MIPER")).toBeNull()
    expect(screen.getAllByText("No hay faenas a tu alcance").length).toBeGreaterThan(0)
  })

  it("con todas las faenas con MIPER, sí lo dice", () => {
    show("", [ROWS[0]!])
    expect(screen.getByText("Todas tienen MIPER")).toBeInTheDocument()
  })
})

describe("MiperHome — vista, estado y enlaces viejos", () => {
  it("el segmento «Requieren mi acción» no repite la cifra de la franja (A5) y filtra con replace y sin scroll", () => {
    show("")
    // La cifra vive sólo en la franja: ningún botón lleva «(n)».
    expect(screen.queryByRole("button", { name: /^Requieren mi acción \(/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Requieren mi acción" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper?vista=mias", { scroll: false })
  })

  it("?tab=porhacer (la bandeja de antes) abre «Requieren mi acción»; cambiar de vista borra el `tab` heredado", () => {
    show("tab=porhacer")
    expect(screen.getByRole("button", { name: "Requieren mi acción" })).toHaveAttribute("aria-pressed", "true")
    expect(tabla().getByText("Faena B")).toBeInTheDocument()
    expect(tabla().queryByText("Faena A")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Todas las faenas" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })

  it("?tab=todas y ?tab=resumen caen en «Todas las faenas»", () => {
    show("tab=resumen")
    expect(screen.getByRole("button", { name: "Todas las faenas" })).toHaveAttribute("aria-pressed", "true")
    expect(tabla().getByText("Faena A")).toBeInTheDocument()
  })

  it("el filtro de estado incluye «Sin MIPER»", () => {
    show("estado=sin_miper")
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument()
    expect(tabla().getByText("Faena C")).toBeInTheDocument()
    expect(tabla().queryByText("Faena A")).toBeNull()
  })

  it("?faena= (enlace del PDTP) acota a esa faena y lo dice en un chip que se puede quitar", () => {
    show("faena=ws-b")
    expect(tabla().queryByText("Faena A")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Faena" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })

  it("?sincontrol=1 deja sólo las faenas con riesgos críticos sin control", () => {
    show("sincontrol=1")
    expect(tabla().getByText("1 crítico sin control")).toBeInTheDocument()
    expect(tabla().queryByText("Faena B")).toBeNull()
    expect(screen.getByRole("button", { name: "Eliminar filtro Riesgos críticos" })).toBeInTheDocument()
  })

  it("ya no hay pestañas ni filtro «Responsable»", () => {
    show("")
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Responsable" })).toBeNull()
  })

  it("«Requieren mi acción» vacía lo dice y ofrece ver todas las faenas (A4)", () => {
    show("vista=mias", [ROWS[0]!])
    expect(screen.getAllByText("No tienes MIPER pendientes").length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole("button", { name: "Ver todas las faenas" })[0]!)
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })
})

describe("MiperHome — estado vacío y búsqueda del TopBar (A4)", () => {
  it("una búsqueda sin resultados lo dice y ofrece «Limpiar búsqueda», que la borra", () => {
    show("estado=vigente")
    search("zzz")
    expect(screen.getAllByText("Ninguna faena coincide con la búsqueda").length).toBeGreaterThan(0)
    expect(screen.queryByText("Ninguna faena coincide con los filtros")).toBeNull()
    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar búsqueda" })[0]!)
    expect(screen.getByRole("textbox", { name: "Filtrar en esta página" })).toHaveValue("")
    expect(tabla().getByText("Faena A")).toBeInTheDocument()
    // Limpiar la búsqueda no toca los filtros de la URL.
    expect(router.replace).not.toHaveBeenCalled()
  })

  it("en «Requieren mi acción» con MIPER pendientes, una búsqueda que vacía la lista NO dice «No tienes MIPER pendientes»", () => {
    show("vista=mias")
    search("zzz")
    expect(screen.queryByText("No tienes MIPER pendientes")).toBeNull()
    expect(screen.getAllByText("Ninguna faena coincide con la búsqueda").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "Limpiar búsqueda" }).length).toBeGreaterThan(0)
  })

  it("si los filtros ya vacían la lista, manda el mensaje de los filtros aunque haya búsqueda", () => {
    show("estado=observada")
    search("Faena")
    expect(screen.getAllByText("Ninguna faena coincide con los filtros").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Limpiar búsqueda" })).toBeNull()
    expect(screen.getAllByRole("button", { name: "Ver todas las faenas" }).length).toBeGreaterThan(0)
  })
})

describe("MiperHome — filas", () => {
  it("cada acción pendiente enlaza a ESA MIPER y la vigente va aparte", () => {
    show("", [row({
      vigente: { id: "m-v", period: 2025, versionNumber: 3, label: "Vigente · v3", isLegacy: false },
      requiresMyAction: true, myActions: [{ matrixId: "m-v", period: 2025, reason: "Con observaciones", kind: "respond" }],
    })])
    expect(tabla().getByRole("link", { name: "Responder · Faena A · 2025" })).toHaveAttribute("href", "/prevencion/miper/m-v?tab=revision")
    expect(tabla().getByRole("link", { name: "Vigente v3 (2025)" })).toHaveAttribute("href", "/prevencion/miper/m-v?tab=resumen")
    expect(tabla().getByRole("link", { name: "Faena A" })).toHaveAttribute("href", "/prevencion/miper/m-a?tab=resumen")
    expect(tabla().getByText("1 crítico sin control en la vigente")).toBeInTheDocument()
  })

  it("con varias MIPER pendientes en la faena, cada botón dice su período además de llevarlo en el nombre", () => {
    show("", [row({
      requiresMyAction: true,
      myActions: [
        { matrixId: "m-27", period: 2027, reason: "Borrador", kind: "continue" },
        { matrixId: "m-26", period: 2026, reason: "Cambios sin enviar", kind: "continue" },
      ],
    })])
    expect(tabla().getByRole("link", { name: "Continuar · Faena A · 2027" })).toHaveTextContent(/^Continuar 2027$/)
    expect(tabla().getByRole("link", { name: "Continuar · Faena A · 2026" })).toHaveTextContent(/^Continuar 2026$/)
  })

  it("con una sola MIPER pendiente el botón no repite el período", () => {
    show("", [row({ requiresMyAction: true, myActions: [{ matrixId: "m-a", period: 2026, reason: "Borrador", kind: "continue" }] })])
    expect(tabla().getByRole("link", { name: "Continuar · Faena A · 2026" })).toHaveTextContent(/^Continuar$/)
  })

  it("muestra la completitud con su barra, y la metodología anterior sin cifra", () => {
    show("", [row({}), row({ id: "ws-d", worksiteId: "ws-d", worksiteName: "Faena D", completeness: null, matrix: { id: "m-d", period: null, versionNumber: null, label: "Vigente · metodología anterior", isLegacy: true } })])
    expect(tabla().getByRole("progressbar", { name: "Faena A: 3 de 4 completos" })).toBeInTheDocument()
    expect(tabla().getAllByText("Metodología anterior").length).toBeGreaterThan(0)
  })

  it("el programa: avance con cifra, «Sin programa» sin ocurrencias planificadas (nunca 0 %) y nada sin MIPER", () => {
    show("", [
      row({}),
      row({ id: "ws-e", worksiteId: "ws-e", worksiteName: "Faena E", programProgress: { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null } }),
      ROWS[2]!,
    ])
    const fila = (faena: string) => within(tabla().getByText(faena).closest("tr")!)
    expect(fila("Faena A").getByText("50% · 1/2")).toBeInTheDocument()
    expect(fila("Faena E").getByText("Sin programa")).toBeInTheDocument()
    expect(fila("Faena E").queryByText(/0\s?%/)).toBeNull()
    expect(fila("Faena C").queryByText("Sin programa")).toBeNull()
  })

  it("el avance redondea hacia abajo: 199 de 200 no es 100% (y 29 de 100 es 29%, sin el error de coma flotante)", () => {
    const at = (done: number, planned: number) => ({ done, late: 0, pending: planned - done, overdue: 0, failed: 0, planned, ratio: done / planned })
    show("", [row({ programProgress: at(199, 200) }), row({ id: "ws-g", worksiteId: "ws-g", worksiteName: "Faena G", programProgress: at(29, 100) })])
    const fila = (faena: string) => within(tabla().getByText(faena).closest("tr")!)
    expect(fila("Faena A").getByText("99% · 199/200")).toBeInTheDocument()
    expect(fila("Faena G").getByText("29% · 29/100")).toBeInTheDocument()
  })

  it("con la vigente aparte, el avance del programa (que es el de la vigente) lo dice: «en la vigente», en la tabla y en la tarjeta", () => {
    const vigente = { id: "m-v", period: 2025, versionNumber: 3, label: "Vigente · v3", isLegacy: false }
    show("", [
      row({ vigente }),
      row({ id: "ws-e", worksiteId: "ws-e", worksiteName: "Faena E", vigente, programProgress: { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null } }),
      row({ id: "ws-f", worksiteId: "ws-f", worksiteName: "Faena F" }),
    ])
    const fila = (faena: string) => within(tabla().getByText(faena).closest("tr")!)
    expect(fila("Faena A").getByText("50% · 1/2 en la vigente")).toBeInTheDocument()
    expect(fila("Faena E").getByText("Sin programa en la vigente")).toBeInTheDocument()
    // Sin vigente aparte la fila ES la vigente (o la única MIPER): no hay nada que aclarar.
    expect(fila("Faena F").getByText("50% · 1/2")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Faena A" })).getByText(/· Programa 50% · 1\/2 en la vigente$/)).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Faena E" })).getByText(/· Sin programa en la vigente$/)).toBeInTheDocument()
  })

  it("la faena sin MIPER ofrece «Crear MIPER», que abre el diálogo con esa faena ya elegida", () => {
    show("")
    fireEvent.click(tabla().getByRole("button", { name: "Crear matriz" }))
    expect(screen.getByRole("dialog", { name: "Crear matriz de riesgos" })).toHaveTextContent("Faena: Faena C")
    fireEvent.click(screen.getByRole("button", { name: /^Completar en la plataforma/ }))
    const dialog = screen.getByRole("dialog", { name: "Nueva MIPER" })
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("Faena C")
  })

  it("sin permiso de edición no hay «Crear MIPER» ni «Nueva MIPER»", () => {
    show("", ROWS, false)
    expect(screen.queryByRole("button", { name: /^Crear matriz/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Crear matriz" })).toBeNull()
  })

  it("sin faenas activas a su alcance, «Nueva MIPER» queda deshabilitada y dice por qué", () => {
    show("", ROWS, true, [])
    const nueva = screen.getAllByRole("button", { name: "Crear matriz" })[0]!
    expect(nueva).toBeDisabled()
    expect(nueva).toHaveAccessibleDescription("No hay faenas activas a tu alcance")
    expect(tabla().queryByRole("button", { name: /^Crear matriz/ })).toBeNull()
  })
})


it("la portada desktop prioriza cuatro columnas y abrir una faena lleva a Inicio", () => {
  show()
  expect(tabla().getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual(["Faena", "Estado", "Trabajo pendiente", "Acción"])
  expect(tabla().getByRole("link", { name: "Faena A" })).toHaveAttribute("href", "/prevencion/miper/m-a?tab=resumen")
  expect(tabla().getByRole("link", { name: "Revisar · Faena B · 2026" })).toHaveAttribute("href", "/prevencion/miper/m-b?tab=revision")
})

it("la creación por Excel conserva la faena elegida en la portada", () => {
  show()
  fireEvent.click(tabla().getByRole("button", { name: "Crear matriz" }))
  fireEvent.click(screen.getByRole("button", { name: /^Importar desde Excel/ }))
  expect(screen.getByRole("combobox", { name: "Faena" })).toHaveTextContent("Faena C")
})
