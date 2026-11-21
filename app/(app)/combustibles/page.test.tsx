// @vitest-environment jsdom
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { PanelData } from "@/lib/combustibles/panel/data"
import { buildPanelSteps } from "@/lib/combustibles/panel/steps"

const requirePermission = vi.hoisted(() => vi.fn())
const loadPanelData = vi.hoisted(() => vi.fn())
const resolveFuelPeriodForPage = vi.hoisted(() => vi.fn())
const getPersonalUseDaysInPeriod = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_PERMANENT_REDIRECT:${to}`) },
}))
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: Record<string, unknown>) => <a href={String(href)} {...rest}>{children as ReactNode}</a>,
}))
vi.mock("@/lib/auth/can", () => ({
  requirePermission,
  can: (session: Session | null, permission: string) => session?.user.permissions.includes(permission as never) ?? false,
}))
vi.mock("@/lib/combustibles/period/server", () => ({ resolveFuelPeriodForPage }))
vi.mock("@/lib/combustibles/panel/data", () => ({ loadPanelData, panelLinker: () => (href: string) => href }))
vi.mock("@/lib/combustibles/panel/queries", () => ({ getPersonalUseDaysInPeriod }))
vi.mock("@/lib/combustibles/section-nav", () => ({
  fuelAddDataOptions: (session: Session) => [{ kind: "planilla", label: "Tengo una planilla", description: "x", href: "/combustibles/fuentes/agregar/planilla", allowed: session.user.permissions.includes("combustibles:import" as never) }],
}))
// La cabecera real empuja su contenido al shell por contexto: acá se vuelca en el árbol para poder leerla.
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p><div data-testid="actions">{actions}</div></header>
  ),
  Breadcrumbs: () => null,
}))
// La cabecera del tablero: la faena (si la hay) va antes de las acciones y el «Exportar Excel» después.
vi.mock("@/components/combustibles/fuel-header-actions", () => ({
  FuelHeaderActions: ({ children, worksites, worksiteId, allWorksitesLabel, exportButton }: {
    children?: ReactNode
    worksites?: ReadonlyArray<{ id: string }>
    worksiteId?: string | null
    allWorksitesLabel?: string
    exportButton?: ReactNode
  }) => (
    <div>
      {worksites ? <div data-testid="filtro-faena" data-faenas={worksites.length} data-value={worksiteId ?? ""} data-todas={allWorksitesLabel ?? ""} /> : null}
      {children}
      {exportButton}
    </div>
  ),
}))
vi.mock("@/components/dashboard/board-export-button", () => ({
  BoardExportButton: ({ title, scope }: { title: string; scope: Record<string, string> }) => (
    <button type="button" data-scope={JSON.stringify(scope)}>Exportar Excel: {title}</button>
  ),
}))
vi.mock("@/components/combustibles/add-fuel-data-button", () => ({
  AddFuelDataButton: () => <button type="button">Agregar datos</button>,
}))

// Los gráficos son server components con sus propias consultas: acá basta saber si el Panel los monta y con qué faena.
vi.mock("./_indicadores/consumo-section", () => ({
  ConsumoSection: ({ worksiteId }: { worksiteId?: string }) => <section aria-label="Consumo" data-faena={worksiteId ?? ""} />,
}))
vi.mock("./_indicadores/eficiencia-section", () => ({ EficienciaSection: () => <section aria-label="Eficiencia" /> }))
const worksites = vi.hoisted(() => ({ list: [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }] }))
vi.mock("./consumo/_components/control-context", () => ({ loadControlContext: async () => ({ worksites: worksites.list }) }))

import PanelPage from "./page"
import { PanelContent } from "./panel-content"

const TODAY = "2026-10-31"
const period = describeFuelPeriod({ kind: "month", year: 2026, month: 10 }, "url", TODAY)

function session(permissions: string[], isGlobal = false): Session {
  return { user: { id: "u1", name: "U", email: "u@example.com", roles: [], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal }, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session
}

const jefatura: PanelData = {
  variant: "jefatura",
  degraded: [],
  total: 9,
  steps: buildPanelSteps({
    period, today: TODAY,
    visible: { fuentes: true, cuadratura: true, pagos: true },
    sources: null, inbox: { total: 2, byKind: { carga: 2, caso: 0, patente: 0, pedido: 0 }, oldestWaitingSince: null, oldestByKind: { carga: null, caso: null, patente: null, pedido: null } },
    reconciliation: null, worse: { count: 0, examples: [] }, hasPerformanceData: true, payables: null,
  }),
}

async function renderPage(sp: Record<string, string | string[] | undefined> = {}) {
  // La página resuelve permiso y URL viejas y entrega el contenido dentro de un
  // Suspense: se renderiza ese contenido (un componente async) ya resuelto.
  const page = await PanelPage({ searchParams: Promise.resolve(sp) }) as ReactElement<{ children: ReactElement<ComponentProps<typeof PanelContent>> }>
  render(await PanelContent(page.props.children.props))
}

describe("página del Panel de combustible", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:approve_flagged", "combustibles:register_load", "combustibles:import"]))
    resolveFuelPeriodForPage.mockResolvedValue(period)
    loadPanelData.mockResolvedValue(jefatura)
    getPersonalUseDaysInPeriod.mockResolvedValue(0)
  })

  it("exige combustibles:view en la ruta del Panel y manda a /forbidden si falta", async () => {
    await renderPage()
    expect(requirePermission).toHaveBeenCalledWith("combustibles:view", "/combustibles")

    requirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(PanelPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/forbidden")
  })

  it("redirige los parámetros viejos antes de consultar nada", async () => {
    await expect(PanelPage({ searchParams: Promise.resolve({ vista: "registros", patente: "KPRT14" }) })).rejects.toThrow(
      "NEXT_PERMANENT_REDIRECT:/combustibles/cargas/tarjetas?patente=KPRT14",
    )
    expect(loadPanelData).not.toHaveBeenCalled()
    expect(resolveFuelPeriodForPage).not.toHaveBeenCalled()
  })

  it("jefatura: abre con el avance y la tira de pasos, y debajo los gráficos de Consumo y Eficiencia", async () => {
    await renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "Panel de combustible" })).toBeInTheDocument()
    expect(screen.getByText("Qué falta para cerrar el período y cómo fue el consumo")).toBeInTheDocument()
    expect(screen.getByText(/pasos listos/)).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: "Pasos para cerrar el período" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Consumo" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Eficiencia" })).toBeInTheDocument()
    // Las tarjetas de antes salieron: las cifras las dan los gráficos y cada paso lleva a lo pendiente.
    expect(screen.queryByRole("heading", { name: "Lo que vence primero" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "El período en tres cifras" })).not.toBeInTheDocument()
    // Hay exactamente un h1 en la página: el título vive en PageHeader.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("la cabecera lleva «Agregar datos» como única entrada de alta: registrar una carga a mano es una de sus opciones", async () => {
    await renderPage()
    const actions = within(screen.getByTestId("actions"))
    expect(actions.getByRole("button", { name: "Agregar datos" })).toBeInTheDocument()
    expect(actions.queryByRole("link", { name: "Registrar carga" })).not.toBeInTheDocument()
  })

  it("sin permiso de importar ni de registrar, la cabecera no ofrece ni lo uno ni lo otro", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:approve_flagged"]))
    await renderPage()
    const actions = within(screen.getByTestId("actions"))
    expect(actions.queryByRole("button", { name: "Agregar datos" })).not.toBeInTheDocument()
    expect(actions.queryByRole("link", { name: "Registrar carga" })).not.toBeInTheDocument()
  })

  it("avisa cuando alguna consulta falló, con cuántas de cuántas", async () => {
    loadPanelData.mockResolvedValue({ ...jefatura, degraded: ["cifras", "fuentes"], total: 9 })
    await renderPage()
    expect(screen.getByRole("alert")).toHaveTextContent("Algunos datos no pudieron cargarse (2 de 9 fuentes)")
  })

  it("sin fallas no muestra el aviso", async () => {
    await renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("terreno: el bloque de registrar y sus conteos, con otra descripción", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:register_load"]))
    loadPanelData.mockResolvedValue({
      variant: "terreno", degraded: [], total: 5, counts: { all: 12, toValidate: 3, withObservation: 1 }, recent: [], toFix: [], ranking: [], planilla: undefined,
    })
    await renderPage()
    expect(screen.getByText("Tus cargas y lo que te toca corregir")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Registrar una carga" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Tus cargas del período" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Pasos para cerrar el período" })).not.toBeInTheDocument()
    // Sin importar permisos, esta variante no tiene «Agregar datos».
    expect(within(screen.getByTestId("actions")).queryByRole("button", { name: "Agregar datos" })).not.toBeInTheDocument()
  })

  it("contrato: además de lo de terreno ofrece «Agregar datos»", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:register_load", "combustibles:import"]))
    loadPanelData.mockResolvedValue({
      variant: "contrato", degraded: [], total: 6, counts: { all: 0, toValidate: 0, withObservation: 0 }, recent: [], toFix: [], ranking: [], planilla: null,
    })
    await renderPage()
    expect(screen.getByText("Tus cargas, tus archivos y lo que falta vincular")).toBeInTheDocument()
    expect(within(screen.getByTestId("actions")).getByRole("button", { name: "Agregar datos" })).toBeInTheDocument()
  })

  it("terreno y contrato conservan su estación de trabajo, sin gráficos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:register_load"]))
    loadPanelData.mockResolvedValue({
      variant: "terreno", degraded: [], total: 5, counts: { all: 0, toValidate: 0, withObservation: 0 }, recent: [], toFix: [], ranking: [], planilla: undefined,
    })
    await renderPage()
    expect(screen.queryByRole("region", { name: "Consumo" })).not.toBeInTheDocument()
  })

  it("consulta: sólo los gráficos, sin pasos ni datos propios del Panel", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view"]))
    await renderPage()
    expect(screen.getByText("Cómo fue el consumo de tus faenas en el período")).toBeInTheDocument()
    expect(loadPanelData).not.toHaveBeenCalled()
    expect(screen.getByRole("region", { name: "Consumo" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Pasos para cerrar el período" })).not.toBeInTheDocument()
    expect(within(screen.getByTestId("actions")).queryByRole("link", { name: "Registrar carga" })).not.toBeInTheDocument()
  })

  it("la faena va en la cabecera, como en los otros tableros, y acota los gráficos", async () => {
    await renderPage({ faena: "ws-2" })
    expect(screen.getByRole("region", { name: "Consumo" })).toHaveAttribute("data-faena", "ws-2")
    const filter = within(screen.getByTestId("actions")).getByTestId("filtro-faena")
    expect(filter).toHaveAttribute("data-value", "ws-2")
    expect(filter).toHaveAttribute("data-faenas", "2")
    // Los pasos no la siguen, y lo dicen.
    expect(screen.getByText(/Los pasos del cierre no se filtran por faena: Cholguán acota sólo los gráficos/)).toBeInTheDocument()
  })

  it("el rótulo de «todas» sigue el alcance: «Todas las faenas» si es global, «Todas tus faenas» si es limitado", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view"], false))
    await renderPage()
    expect(screen.getByTestId("filtro-faena")).toHaveAttribute("data-todas", "Todas tus faenas")
    cleanup()

    requirePermission.mockResolvedValue(session(["combustibles:view"], true))
    await renderPage()
    expect(screen.getByTestId("filtro-faena")).toHaveAttribute("data-todas", "Todas las faenas")
  })

  it("una faena fuera del alcance (o inventada) se ignora, como en los otros tableros", async () => {
    await renderPage({ faena: "ws-ajena" })
    expect(screen.getByRole("region", { name: "Consumo" })).toHaveAttribute("data-faena", "")
    expect(screen.getByTestId("filtro-faena")).toHaveAttribute("data-value", "")
    expect(screen.queryByText(/no se filtran por faena/)).not.toBeInTheDocument()
  })

  it("«Exportar Excel» del tablero va en la cabecera sólo con el permiso de exportar, con el período y la faena", async () => {
    await renderPage({ faena: "ws-1" })
    expect(within(screen.getByTestId("actions")).queryByRole("button", { name: /Exportar Excel/ })).not.toBeInTheDocument()
    cleanup()

    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:export"]))
    await renderPage({ faena: "ws-1" })
    const button = within(screen.getByTestId("actions")).getByRole("button", { name: "Exportar Excel: Panel de combustible" })
    expect(JSON.parse(button.getAttribute("data-scope")!)).toEqual({ periodo: period.label, faena: "Biodiversa" })
  })

  it("terreno no recibe la faena ni la exportación del tablero: no tiene gráficos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:register_load", "combustibles:export"]))
    loadPanelData.mockResolvedValue({
      variant: "terreno", degraded: [], total: 5, counts: { all: 0, toValidate: 0, withObservation: 0 }, recent: [], toFix: [], ranking: [], planilla: undefined,
    })
    await renderPage()
    expect(screen.queryByTestId("filtro-faena")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Exportar Excel/ })).not.toBeInTheDocument()
  })

  it("avisa «Excluye uso personal» sólo cuando el período y el alcance tienen días de uso personal", async () => {
    await renderPage()
    expect(screen.queryByText("Excluye uso personal")).not.toBeInTheDocument()
    cleanup()

    getPersonalUseDaysInPeriod.mockResolvedValue(4)
    await renderPage({ faena: "ws-2" })
    expect(screen.getByText("Excluye uso personal")).toBeInTheDocument()
    // La consulta mide el mismo período y la faena que acotan los gráficos.
    expect(getPersonalUseDaysInPeriod).toHaveBeenLastCalledWith(expect.anything(), period.from, period.to, { worksiteId: "ws-2" })
  })

  it("la nota también está en la variante de consulta, que sólo ve los gráficos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view"]))
    getPersonalUseDaysInPeriod.mockResolvedValue(1)
    await renderPage()
    expect(screen.getByText("Excluye uso personal")).toBeInTheDocument()
  })

  it("terreno y contrato no tienen gráficos ni nota", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:register_load"]))
    loadPanelData.mockResolvedValue({
      variant: "terreno", degraded: [], total: 5, counts: { all: 0, toValidate: 0, withObservation: 0 }, recent: [], toFix: [], ranking: [], planilla: undefined,
    })
    getPersonalUseDaysInPeriod.mockResolvedValue(5)
    await renderPage()
    expect(screen.queryByText("Excluye uso personal")).not.toBeInTheDocument()
  })

  it("si la consulta de uso personal cae, el Panel sigue sin la nota", async () => {
    getPersonalUseDaysInPeriod.mockRejectedValue(new Error("db caída"))
    await renderPage()
    expect(screen.queryByText("Excluye uso personal")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Consumo" })).toBeInTheDocument()
  })

  it("elige la variante por el permiso de la sesión y se la pasa a la carga de datos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:view_costs"], true))
    await renderPage()
    expect(loadPanelData).toHaveBeenCalledWith(expect.anything(), period, "jefatura")
  })
})
