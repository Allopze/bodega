// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
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
    criticalWithoutControl: 0, requiresMyAction: true, myActions: [{ matrixId: "m-b", period: 2026, reason: "Pendiente de tu revisión" }], submittedByName: "Ana",
  }),
  row({
    id: "ws-c", worksiteId: "ws-c", worksiteName: "Faena C", matrix: null, status: "sin_miper", stateLabel: "Sin MIPER", headcount: 3,
    headcountSource: "trabajadores", updatedAt: null, completeness: null, importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0, programProgress: null,
  }),
]
const CREATION = [{ id: "ws-c", name: "Faena C", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false }]

function show(query = "", rows: MiperPortfolioRow[] = ROWS, canEdit = true, creation = canEdit ? CREATION : []) {
  nav.query = query
  return render(
    <ShellHeaderProvider>
      <MiperHome rows={rows} creationWorksites={creation} currentYear={2026} permissions={{ canEdit, canManageCatalog: false }} />
    </ShellHeaderProvider>,
  )
}
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

describe("MiperHome — filas", () => {
  it("cada acción pendiente enlaza a ESA MIPER y la vigente va aparte", () => {
    show("", [row({
      vigente: { id: "m-v", period: 2025, versionNumber: 3, label: "Vigente · v3", isLegacy: false },
      requiresMyAction: true, myActions: [{ matrixId: "m-v", period: 2025, reason: "Con observaciones" }],
    })])
    expect(tabla().getByRole("link", { name: "Con observaciones · MIPER 2025" })).toHaveAttribute("href", "/prevencion/miper/m-v")
    expect(tabla().getByRole("link", { name: "Vigente v3 (2025)" })).toHaveAttribute("href", "/prevencion/miper/m-v")
    expect(tabla().getByRole("link", { name: "Faena A" })).toHaveAttribute("href", "/prevencion/miper/m-a")
    expect(tabla().getByText("1 crítico sin control en la vigente")).toBeInTheDocument()
  })

  it("muestra la completitud con su barra, y la metodología anterior sin cifra", () => {
    show("", [row({}), row({ id: "ws-d", worksiteId: "ws-d", worksiteName: "Faena D", completeness: null, matrix: { id: "m-d", period: null, versionNumber: null, label: "Vigente · metodología anterior", isLegacy: true } })])
    expect(tabla().getByRole("progressbar", { name: "Faena A: 3 de 4 completos" })).toBeInTheDocument()
    expect(tabla().getByText("Metodología anterior")).toBeInTheDocument()
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

  it("la faena sin MIPER ofrece «Crear MIPER», que abre el diálogo con esa faena ya elegida", () => {
    show("")
    fireEvent.click(tabla().getByRole("button", { name: "Crear MIPER de Faena C" }))
    const dialog = screen.getByRole("dialog", { name: "Nueva MIPER" })
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("Faena C")
  })

  it("sin permiso de edición no hay «Crear MIPER» ni «Nueva MIPER»", () => {
    show("", ROWS, false)
    expect(screen.queryByRole("button", { name: /^Crear MIPER/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Nueva MIPER" })).toBeNull()
  })

  it("sin faenas activas a su alcance, «Nueva MIPER» queda deshabilitada y dice por qué", () => {
    show("", ROWS, true, [])
    const nueva = screen.getAllByRole("button", { name: "Nueva MIPER" })[0]!
    expect(nueva).toBeDisabled()
    expect(nueva).toHaveAccessibleDescription("No hay faenas activas a tu alcance")
    expect(tabla().queryByRole("button", { name: /^Crear MIPER/ })).toBeNull()
  })
})
