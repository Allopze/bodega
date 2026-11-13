// @vitest-environment jsdom
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { render, screen, within } from "@testing-library/react"
import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { PanelData } from "@/lib/combustibles/panel/data"
import { buildPanelSteps } from "@/lib/combustibles/panel/steps"

const requirePermission = vi.hoisted(() => vi.fn())
const loadPanelData = vi.hoisted(() => vi.fn())
const resolveFuelPeriodForPage = vi.hoisted(() => vi.fn())

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
vi.mock("@/components/combustibles/fuel-header-actions", () => ({
  FuelHeaderActions: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/combustibles/add-fuel-data-button", () => ({
  AddFuelDataButton: () => <button type="button">Agregar datos</button>,
}))

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
    sources: null, inbox: { total: 2, byKind: { carga: 2, caso: 0, patente: 0, pedido: 0 }, oldestWaitingSince: null },
    reconciliation: null, worse: { count: 0, examples: [] }, hasPerformanceData: true, payables: null,
  }),
  due: { kind: "empty" },
  figures: null,
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

  it("jefatura: abre con el avance, la tira de pasos y los dos bloques", async () => {
    await renderPage()
    expect(screen.getByRole("heading", { level: 1, name: "Panel de combustible" })).toBeInTheDocument()
    expect(screen.getByText("Cómo va el período y qué falta para cerrarlo")).toBeInTheDocument()
    expect(screen.getByText(/pasos listos/)).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: "Pasos para cerrar el período" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Lo que vence primero" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "El período en tres cifras" })).toBeInTheDocument()
    // Hay exactamente un h1 en la página: el título vive en PageHeader.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("la cabecera lleva «Agregar datos» sólo si alguna opción está permitida y «Registrar carga» sólo con register_load", async () => {
    await renderPage()
    const actions = within(screen.getByTestId("actions"))
    expect(actions.getByRole("button", { name: "Agregar datos" })).toBeInTheDocument()
    expect(actions.getByRole("link", { name: "Registrar carga" })).toHaveAttribute("href", "/combustibles/cargas/registrar")
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

  it("consulta: tres frases y nada de pasos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view"]))
    loadPanelData.mockResolvedValue({ variant: "consulta", degraded: [], total: 4, figures: null, worse: null, measured: null, unlinkedPlates: null })
    await renderPage()
    expect(screen.getByText("El combustible de tus faenas, en tres frases")).toBeInTheDocument()
    expect(screen.getByText(/No se pudieron calcular los litros de octubre/)).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Pasos para cerrar el período" })).not.toBeInTheDocument()
    expect(within(screen.getByTestId("actions")).queryByRole("link", { name: "Registrar carga" })).not.toBeInTheDocument()
  })

  it("elige la variante por el permiso de la sesión y se la pasa a la carga de datos", async () => {
    requirePermission.mockResolvedValue(session(["combustibles:view", "combustibles:view_costs"], true))
    await renderPage()
    expect(loadPanelData).toHaveBeenCalledWith(expect.anything(), period, "jefatura")
  })
})
