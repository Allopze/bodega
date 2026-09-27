// @vitest-environment jsdom
/**
 * PREV-M09: la bandeja de obligaciones se pagina en el servidor, así que sus
 * filtros viajan en la URL (`router.replace` sin scroll, como el resto de los
 * filtros de la plataforma) y el texto se busca en la base con su propio
 * input. PREV-I03: "Reportar trabajo" sólo en los casos propios.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { PdtpObligationsWorkbench as Workbench } from "./pdtp-obligations-workbench"

/** PageHeader proyecta su contenido en el TopBar: necesita el proveedor del shell. */
function PdtpObligationsWorkbench(props: React.ComponentProps<typeof Workbench>) {
  return <ShellHeaderProvider><Workbench {...props} /></ShellHeaderProvider>
}

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), search: new URLSearchParams() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/prevencion/pdtp/obligaciones",
  useSearchParams: () => nav.search,
}))
vi.mock("./actions", () => ({
  createPdtpObligationAction: vi.fn(),
  reportPdtpObligationAction: vi.fn(),
  cancelPdtpObligationAction: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  nav.search = new URLSearchParams()
})
afterEach(() => cleanup())

function row(id: string, activityName: string, effectiveStatus: "pending" | "overdue" | "reported") {
  return {
    obligation: {
      id, activityId: `act-${id}`, worksiteId: "ws-1", dueAt: "2026-07-01T00:00:00.000Z", plannedQuantity: 1,
      status: effectiveStatus, sourceType: null, sourceId: null, sourceMetadataJson: {},
    },
    activityNumber: 1, activityName, worksiteName: "Faena Alfa", effectiveStatus,
  } as never
}

const BASE = {
  worksites: [{ id: "ws-1", name: "Faena Alfa" }],
  activities: [{ id: "act-1" }] as never,
  obligations: [row("o-1", "Inducción de hombre nuevo", "pending"), row("o-2", "Investigación de incidente", "overdue")],
  counts: { pending: 30, overdue: 12, reported: 4 },
  total: 46,
  pagination: <nav aria-label="Paginación">1 - 25 de 46</nav>,
  filters: { status: "open" as const, worksiteId: "all", search: "" },
  canExecute: true,
  canCancel: false,
}

describe("PdtpObligationsWorkbench — filtros en la URL", () => {
  it("los tiles muestran los contadores del servidor, no los de la página", () => {
    render(<PdtpObligationsWorkbench {...BASE} />)
    const tile = screen.getByRole("button", { name: /Vencidas/ })
    expect(within(tile).getByText("12")).toBeDefined()
  })

  it("un tile filtra por estado reemplazando la URL, sin scroll y volviendo a la página 1", () => {
    nav.search = new URLSearchParams("page=3&faena=ws-1")
    render(<PdtpObligationsWorkbench {...BASE} />)
    fireEvent.click(screen.getByRole("button", { name: /Vencidas/ }))
    expect(nav.replace).toHaveBeenCalledWith("/prevencion/pdtp/obligaciones?faena=ws-1&estado=overdue", { scroll: false })
  })

  it("tiene su propio buscador (la búsqueda es en la base) y la paginación del servidor", () => {
    render(<PdtpObligationsWorkbench {...BASE} />)
    expect(screen.getByRole("searchbox", { name: "Buscar casos" })).toBeDefined()
    expect(screen.getByRole("navigation", { name: "Paginación" })).toBeDefined()
  })

  it("sin resultados con filtros ofrece limpiarlos", () => {
    render(<PdtpObligationsWorkbench {...BASE} obligations={[]} total={0} filters={{ status: "overdue", worksiteId: "all", search: "xyz" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/prevencion/pdtp/obligaciones", { scroll: false })
  })
})

describe("PdtpObligationsWorkbench — PREV-I03", () => {
  it("'Reportar trabajo' sólo aparece en los casos que la persona puede reportar", () => {
    render(<PdtpObligationsWorkbench {...BASE} reportableObligationIds={["o-2"]} />)
    const own = screen.getByText("Investigación de incidente").closest("article")!
    const foreign = screen.getByText("Inducción de hombre nuevo").closest("article")!
    expect(within(own).queryByRole("button", { name: "Reportar trabajo" })).not.toBeNull()
    expect(within(foreign).queryByRole("button", { name: "Reportar trabajo" })).toBeNull()
  })
})
