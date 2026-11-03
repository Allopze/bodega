// @vitest-environment jsdom
/**
 * Regla A5 (una dimensión = una representación interactiva): el estado de la acción
 * CAPA es una fila de pestañas con contador, sin `Select` de estado ni tarjetas por
 * estado. Las tarjetas que quedan son condiciones que cruzan los estados.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildCapaStatusCounts } from "@/lib/prevention/capa-list-filters"
import { resolvePagination } from "@/lib/pagination"

let search = ""
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/capa",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

const { CapaList } = await import("./capa-list")

const STATUS_COUNTS = buildCapaStatusCounts([
  { status: "pending", total: 2 },
  { status: "in_progress", total: 3 },
  { status: "pending_verification", total: 1 },
  { status: "closed", total: 4 },
])
const COUNTS = { overdue: 2, unreconciled: 1, immediateStop: 1 }

function action(overrides: Partial<Parameters<typeof CapaList>[0]["actions"][number]> = {}) {
  return {
    id: "capa-1", code: "CAPA-0001", sourceType: "manual", sourceId: "s-1", worksiteId: "ws-1",
    finding: "Protección perimetral faltante", actionDescription: "Instalar baranda", responsibleSnapshot: null,
    responsibleUserId: null, responsibleName: "Ana Soto", priority: "high", targetDate: "2099-12-31", status: "pending",
    reconciliationStatus: "reconciled", requiresImmediateStop: false, createdAt: "2026-08-01T08:00:00.000Z", ...overrides,
  }
}

function renderList(props: Partial<Parameters<typeof CapaList>[0]> = {}) {
  return render(
    <CapaList
      actions={[action()]}
      worksites={[{ id: "ws-1", name: "Faena Norte" }]}
      counts={COUNTS}
      statusCounts={STATUS_COUNTS}
      pagination={resolvePagination({ pageParam: "1", totalItems: 1, pageSize: 50 })}
      {...props}
    />,
  )
}

beforeEach(() => {
  search = ""
  replace.mockClear()
})
afterEach(cleanup)

describe("lista CAPA — el estado son pestañas con contador (A5)", () => {
  it("muestra una pestaña por estado más «Todas» y «Abiertas», cada una con su contador", () => {
    renderList()
    const tabs = screen.getByRole("navigation", { name: "Estado de las acciones CAPA" })

    expect(within(tabs).getAllByRole("link").map((link) => link.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Todas 10", "Abiertas 6", "Pendiente 2", "En proceso 3", "Pendiente de verificación 1", "Verificada 0", "Cerrada 4", "Reabierta 0", "Cancelada 0",
    ])
  })

  it("marca la pestaña del estado de la URL y no hay un Select de estado", () => {
    search = "status=in_progress"
    renderList()

    expect(screen.getByRole("link", { name: /^En proceso\s*3$/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByRole("combobox", { name: "Estado CAPA" })).toBeNull()
    // Siguen los filtros de otras dimensiones.
    expect(screen.getByRole("combobox", { name: "Fuente CAPA" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Faena CAPA" })).toBeTruthy()
  })

  it("cambiar de pestaña conserva el resto de los filtros, incluida la tarjeta activa, y vuelve a la primera página", () => {
    search = "vista=overdue&source=inspection&page=3"
    renderList()

    expect(screen.getByRole("link", { name: /^En proceso\s*3$/ }).getAttribute("href"))
      .toBe("/prevencion/capa?vista=overdue&source=inspection&status=in_progress")
    expect(screen.getByRole("link", { name: /^Todas\s*10$/ }).getAttribute("href"))
      .toBe("/prevencion/capa?vista=overdue&source=inspection")
  })

  it("el estado elegido no se repite como chip de filtro activo", () => {
    search = "status=closed"
    renderList()

    expect(screen.queryByText("Filtros activos:")).toBeNull()
  })
})

describe("lista CAPA — las tarjetas son condiciones que cruzan los estados", () => {
  const tiles = () => screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"))

  it("sólo quedan «Exigen detener la tarea» y «Vencidas»: «Abiertas» y «Por verificar» eran estados", () => {
    renderList()

    expect(tiles().map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Exigen detener la tarea"),
      expect.stringContaining("Vencidas"),
    ])
    expect(within(tiles()[0]!).getByText("1")).toBeTruthy()
    expect(within(tiles()[1]!).getByText("2")).toBeTruthy()
  })

  it("activar una tarjeta pone la condición en la URL sin perder el estado y sin saltar al inicio; volver a pulsarla la quita", () => {
    search = "status=in_progress"
    renderList()
    fireEvent.click(tiles()[1]!)

    expect(replace).toHaveBeenCalledWith("/prevencion/capa?status=in_progress&vista=overdue", { scroll: false })

    cleanup()
    search = "status=in_progress&vista=overdue"
    renderList()
    expect(tiles()[1]!.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(tiles()[1]!)
    expect(replace).toHaveBeenLastCalledWith("/prevencion/capa?status=in_progress", { scroll: false })
  })

  it("la condición activa se anuncia como chip de «Vista» que se puede quitar", () => {
    search = "vista=immediate_stop&status=open"
    renderList()

    expect(screen.getByText("Exigen detener la tarea", { selector: "span.font-medium" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Vista" }))
    expect(replace).toHaveBeenCalledWith("/prevencion/capa?status=open", { scroll: false })
  })

  it("«Limpiar filtros» conserva la pestaña (el estado no es un filtro) y quita lo demás", () => {
    search = "status=in_progress&vista=overdue&source=inspection&page=2"
    renderList()
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))

    expect(replace).toHaveBeenCalledWith("/prevencion/capa?status=in_progress", { scroll: false })
  })
})

describe("lista CAPA — la lista llega filtrada del servidor", () => {
  it("muestra todas las filas recibidas: no vuelve a filtrar por condición en el navegador", () => {
    search = "vista=overdue"
    renderList({ actions: [action(), action({ id: "capa-2", code: "CAPA-0002", status: "in_progress" })] })

    expect(screen.getByText("CAPA-0001")).toBeTruthy()
    expect(screen.getByText("CAPA-0002")).toBeTruthy()
  })

  it("una lista vacía por un filtro (estado incluido) lo dice y «Ver todas» limpia todo, también la pestaña", () => {
    search = "status=cancelled"
    renderList({ actions: [] })

    expect(screen.getByText("No hay acciones con estos filtros")).toBeTruthy()
    expect(screen.queryByText("Aún no hay acciones CAPA")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }))
    expect(replace).toHaveBeenCalledWith("/prevencion/capa", { scroll: false })
  })

  it("sin ningún filtro, una lista vacía explica cómo se llena y no ofrece «Ver todas»", () => {
    renderList({ actions: [] })

    expect(screen.getByText("Aún no hay acciones CAPA")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ver todas" })).toBeNull()
  })

  it("la tabla pinta el estado de cada fila con su rótulo en español", () => {
    renderList({ actions: [action({ status: "pending_verification" })] })

    // Una vez en la pestaña y otra en el badge de la fila: el rótulo es el mismo.
    expect(screen.getAllByText("Pendiente de verificación").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText("pending_verification")).toBeNull()
  })
})
