// @vitest-environment jsdom
/**
 * Regla A5 (una dimensión = una representación interactiva): el estado del incidente
 * es una fila de pestañas con contador, sin `Select` de estado ni tarjetas por estado.
 * Las tarjetas que quedan son condiciones que cruzan los estados.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildIncidentStatusCounts } from "@/lib/prevention/incident-list-filters"

let search = ""
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/incidentes",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

const { IncidentList } = await import("./incident-list")

const STATUS_COUNTS = buildIncidentStatusCounts([
  { status: "reported", total: 2 },
  { status: "under_investigation", total: 3 },
  { status: "closed", total: 5 },
])
const COUNTS = { overdueNotifications: 1, fatalOrSerious: 2 }

function incident(overrides: Partial<Parameters<typeof IncidentList>[0]["incidents"][number]> = {}) {
  return {
    id: "inc-1", code: "INC-0001", worksiteId: "ws-1", worksiteName: "Faena Norte", companyName: "Empresa Uno",
    eventType: "work_accident", status: "reported", occurredAt: "2026-05-20T15:00:00.000Z", knownAt: "2026-05-20T15:30:00.000Z",
    location: "Rampa", actualSeverity: "minor", potentialSeverity: "minor", isFatalOrSerious: false,
    hasOverdueNotifications: false, source: "web", version: 1, ...overrides,
  }
}

function renderList(props: Partial<Parameters<typeof IncidentList>[0]> = {}) {
  return render(
    <IncidentList
      incidents={[incident()]}
      worksites={[{ id: "ws-1", name: "Faena Norte" }]}
      counts={COUNTS}
      statusCounts={STATUS_COUNTS}
      canReport
      {...props}
    />,
  )
}

beforeEach(() => {
  search = ""
  replace.mockClear()
})
afterEach(cleanup)

describe("lista de incidentes — el estado son pestañas con contador (A5)", () => {
  it("muestra una pestaña por estado más «Todos» y «Abiertos», cada una con su contador", () => {
    renderList()
    const tabs = screen.getByRole("navigation", { name: "Estado de los incidentes" })

    expect(within(tabs).getAllByRole("link").map((link) => link.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Todos 10", "Abiertos 5", "Reportado 2", "En triage 0", "Medidas inmediatas 0", "En investigación 3",
      "Pendiente CAPA 0", "Pendiente verificación 0", "Cerrado 5",
    ])
  })

  it("marca la pestaña del estado de la URL y no hay un Select de estado", () => {
    search = "status=closed"
    renderList()

    expect(screen.getByRole("link", { name: /^Cerrado\s*5$/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByRole("combobox", { name: "Estado del incidente" })).toBeNull()
    // Siguen los filtros de otras dimensiones.
    expect(screen.getByRole("combobox", { name: "Tipo de evento" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Faena" })).toBeTruthy()
  })

  it("«Abiertos» (el destino de ?quick=open del tablero) es una pestaña con su propio contador", () => {
    search = "status=open"
    renderList()

    const open = screen.getByRole("link", { name: /^Abiertos\s*5$/ })
    expect(open.getAttribute("aria-current")).toBe("page")
    expect(open.getAttribute("href")).toBe("/prevencion/incidentes?status=open")
  })

  it("cambiar de pestaña conserva el resto de los filtros, incluida la tarjeta activa", () => {
    search = "quick=overdue&eventType=work_accident"
    renderList()

    expect(screen.getByRole("link", { name: /^Cerrado\s*5$/ }).getAttribute("href"))
      .toBe("/prevencion/incidentes?quick=overdue&eventType=work_accident&status=closed")
    expect(screen.getByRole("link", { name: /^Todos\s*10$/ }).getAttribute("href"))
      .toBe("/prevencion/incidentes?quick=overdue&eventType=work_accident")
  })

  it("el estado elegido no se repite como chip de filtro activo", () => {
    search = "status=closed"
    renderList()

    expect(screen.queryByText("Filtros activos:")).toBeNull()
    expect(screen.queryByRole("button", { name: "Eliminar filtro Estado" })).toBeNull()
  })
})

describe("lista de incidentes — las tarjetas son condiciones que cruzan los estados", () => {
  const tiles = () => screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"))

  it("sólo quedan «Plazos atrasados» y «Fatal o grave»: «Abiertos» y «Por investigar» eran estados", () => {
    renderList()

    expect(tiles().map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Plazos atrasados"),
      expect.stringContaining("Fatal o grave"),
    ])
    expect(within(tiles()[0]!).getByText("1")).toBeTruthy()
    expect(within(tiles()[1]!).getByText("2")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Por investigar/ })).toBeNull()
  })

  it("activar una tarjeta pone la condición en la URL sin perder el estado y sin saltar al inicio; volver a pulsarla la quita", () => {
    search = "status=closed"
    renderList()
    fireEvent.click(tiles()[0]!)

    expect(replace).toHaveBeenCalledWith("/prevencion/incidentes?status=closed&quick=overdue", { scroll: false })

    cleanup()
    search = "status=closed&quick=overdue"
    renderList()
    expect(tiles()[0]!.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(tiles()[0]!)
    expect(replace).toHaveBeenLastCalledWith("/prevencion/incidentes?status=closed", { scroll: false })
  })

  it("«Limpiar filtros» conserva la pestaña (el estado no es un filtro) y quita lo demás", () => {
    search = "status=closed&quick=fatal&eventType=work_accident"
    renderList()
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))

    expect(replace).toHaveBeenCalledWith("/prevencion/incidentes?status=closed", { scroll: false })
  })
})

describe("lista de incidentes — la lista llega filtrada del servidor", () => {
  it("muestra todas las filas recibidas: no vuelve a filtrar por estado, tipo ni condición en el navegador", () => {
    search = "status=closed&eventType=dangerous_incident&quick=fatal"
    renderList({ incidents: [incident(), incident({ id: "inc-2", code: "INC-0002", status: "under_investigation" })] })

    expect(screen.getAllByText("INC-0001").length).toBeGreaterThan(0)
    expect(screen.getAllByText("INC-0002").length).toBeGreaterThan(0)
  })

  it("una lista vacía por un filtro (estado incluido) lo dice y ofrece ver todos; sin filtros invita a reportar", () => {
    search = "status=closed"
    renderList({ incidents: [] })
    // La tabla pinta el estado vacío dos veces (móvil y escritorio): no se usa `getBy*`.
    expect(screen.getAllByText("No hay incidentes con estos filtros").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "Ver todos" }).length).toBeGreaterThan(0)
    expect(screen.queryByText("Aún no hay incidentes canónicos")).toBeNull()

    cleanup()
    search = ""
    renderList({ incidents: [] })
    expect(screen.getAllByText("Aún no hay incidentes canónicos").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("link", { name: "Reportar incidente" }).length).toBeGreaterThan(0)
  })

  it("«Ver todos» limpia todo, también la pestaña", () => {
    search = "status=closed"
    renderList({ incidents: [] })
    fireEvent.click(screen.getAllByRole("button", { name: "Ver todos" })[0]!)

    expect(replace).toHaveBeenCalledWith("/prevencion/incidentes", { scroll: false })
  })
})
